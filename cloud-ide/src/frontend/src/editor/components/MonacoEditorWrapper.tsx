// frontend/src/editor/components/MonacoEditorWrapper.tsx
import React, { useRef, useEffect, useState } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type * as MonacoNs from 'monaco-editor';
import { EditorInputManager } from '../core/EditorInputManager';
import { LanguageServiceRegistry } from '../lsp';
import { LanguageRegistry } from '../languages';
import { OpenFileContext, IDEGlobalSettings, EditorEventPayloads } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';


interface MonacoEditorProps {
  activeFile: OpenFileContext | null;
  globalSettings: IDEGlobalSettings;
  eventBus: EditorEventBus;
  registry: LanguageServiceRegistry;
  languages: LanguageRegistry;
  /**
   * The language to render the active file as — already resolved by the workspace,
   * which applies any user override from the status-bar picker on top of detect().
   * Passed in rather than re-detected here, or a manual override would be silently
   * overwritten by the guess it was chosen to replace.
   */
  languageId: string | null;
}

/** Where a go-to-definition wants the cursor. Monaco hands us either shape. */
type RevealTarget = MonacoNs.IRange | MonacoNs.IPosition;

/** Put the cursor on a definition target and scroll it into view. */
function revealRange(editor: any, target: RevealTarget) {
  const lineNumber = 'startLineNumber' in target ? target.startLineNumber : target.lineNumber;
  const column = 'startColumn' in target ? target.startColumn : target.column;
  editor.setPosition({ lineNumber, column });
  editor.revealLineInCenterIfOutsideViewport(lineNumber);
  editor.focus();
}

export const MonacoEditorWrapper = ({ activeFile, globalSettings, eventBus, registry, languages, languageId }: MonacoEditorProps) => {
  const editorRef = useRef<any>(null);
  const inputManagerRef = useRef<EditorInputManager | null>(null);
  const disposablesRef = useRef<any[]>([]); // Track disposables for cleanup
  // A go-to-definition target whose file is still loading — revealed on FILE_LOADED.
  const pendingRevealRef = useRef<{ path: string; selection: RevealTarget } | null>(null);
  // True only while FILE_LOADED is seeding a model from the VFS, so the change
  // event that seeding emits isn't mistaken for the user typing.
  const loadingRef = useRef(false);
  // Latest settings, readable from the (mount-time) input manager closure.
  const settingsRef = useRef(globalSettings);
  settingsRef.current = globalSettings;
  // The file on screen right now, readable from the mount-time FILE_LOADED closure —
  // which fires for background tabs too and must not steal the editor from this one.
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activeFile?.path ?? null;
  // The monaco namespace is only available from onMount; `mounted` re-runs the
  // language-service effect once it is.
  const monacoRef = useRef<typeof MonacoNs | null>(null);
  const [mounted, setMounted] = useState(false);

  // Language services, installed OUTSIDE onMount because the registry arrives late:
  // which languages have a server is a property of the sandbox's environment, fetched
  // at boot. When the answer lands the registry is replaced, and this re-installs the
  // providers against it. Disposing the old handles first keeps duplicate completion
  // items from a stale bridge out of the dropdown.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!mounted || !monaco) return;

    const installed = registry.install(monaco);
    return () => installed.forEach((d) => d.dispose());
  }, [registry, mounted]);


  /**
   * Jump to a go-to-definition target once its file is both loaded AND on screen.
   * Two things have to be true and they can land in either order, so this is called
   * from both: FILE_LOADED (content arrived) and the effect below (the tab became
   * active). Whichever happens second does the reveal; the ref makes it idempotent.
   */
  const revealIfPending = (path: string) => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.path !== path || !editorRef.current) return;
    pendingRevealRef.current = null;
    revealRange(editorRef.current, pending.selection);
  };

  // The tab caught up with a definition we already loaded — reveal it now. Without
  // this, gating the setModel above on the active path would silently break
  // go-to-definition whenever the content arrived before React re-rendered.
  useEffect(() => {
    if (activeFile?.path) revealIfPending(activeFile.path);
  }, [activeFile?.path]);

  // 1. Handle Editor Mount
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // TODO: make the theme object central like we did with the terminal
     // Define a custom theme that perfectly matches our #1e1e1e background
    monaco.editor.defineTheme('cloud-ide-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#2b2d31',
      },
    });
    // 1. Setup Theme & Input Interception (Ctrl+S, etc.)
    monaco.editor.setTheme('cloud-ide-dark');
    const inputManager = new EditorInputManager(
      editor, eventBus, activeFile?.path || '',
      () => settingsRef.current.formatOnSave,
    );
    // Monaco mounts once, but the active file changes as the user switches tabs.
    // Keep the input manager's path current so Ctrl+S targets the RIGHT file —
    // otherwise SAVE_REQUESTED carries the first-opened path forever and the
    // active tab's dirty dot never clears. Synced by the effect below.
    inputManagerRef.current = inputManager;

    // 2. Language services (completion/hover/...) are NOT installed here — which
    //    languages have a server is fetched per sandbox, so the registry can be
    //    replaced after mount. The effect below owns that install/re-install.
    monacoRef.current = monaco;
    setMounted(true);

    // 2b. Install any custom syntax grammars. Built-in languages need nothing —
    //     Monaco already tokenizes them — so this is a no-op until a plugin adds
    //     a grammar the editor doesn't ship.
    disposablesRef.current.push(...languages.install(monaco));

    // Shift+Alt+F (or File menu) -> run monaco's format action, which invokes
    // whichever formatting provider is registered (a language transport's via
    // the bridge, or a monaco built-in). No-op if none is registered.
    const unsubscribeFormat = eventBus.on('COMMAND_FORMAT', () => {
      editor.getAction('editor.action.formatDocument')?.run();
    });
    disposablesRef.current.push({ dispose: unsubscribeFormat });

    // Go-to-definition into a file we have no model for — the stdlib, something
    // under site-packages, or just an unopened workspace file. Monaco's default is
    // to give up silently, which is why go-to-def looked broken. Route it through
    // the normal open path (FILE_OPEN_REQUESTED already knows how to fetch an
    // out-of-workspace file read-only) and reveal the target once it loads.
    disposablesRef.current.push(monaco.editor.registerEditorOpener({
      openCodeEditor: (
        _source: MonacoNs.editor.ICodeEditor,
        resource: MonacoNs.Uri,
        selection?: RevealTarget,
      ) => {
        const existing = monaco.editor.getModel(resource);
        if (existing) {
          editor.setModel(existing);
          if (selection) revealRange(editor, selection);
          return true;
        }
        // Not loaded yet: stash where to jump, then ask the VFS for the file. The
        // FILE_LOADED handler below performs the reveal once the model exists.
        pendingRevealRef.current = selection ? { path: resource.path, selection } : null;
        eventBus.emit('FILE_OPEN_REQUESTED', { path: resource.path });
        return true;
      },
    }));

    // Listen for incoming file data from the VFS.
    //
    // The VFS is authoritative for a model's content, INCLUDING when the model
    // already exists. Opening a tab dispatches OPEN_FILE synchronously, which
    // re-renders <Editor> with the new `path`; @monaco-editor/react then creates
    // an EMPTY model for that path immediately. The content fetch lands after.
    // We used to only fill in a model we created ourselves, so whenever that
    // empty model got there first the fetched content was dropped on the floor —
    // any file whose blob wasn't already cached (everything `npm` had just
    // generated) opened blank.
    const unsubscribeLoaded = eventBus.on('FILE_LOADED', ({ path, content, language }) => {
      const uri = monaco.Uri.parse(path);
      let model = monaco.editor.getModel(uri);

      if (!model) {
        model = monaco.editor.createModel(content, language, uri);
      } else if (model.getValue() !== content) {
        // setValue fires a content change synchronously; suppress the resulting
        // CONTENT_CHANGED so loading a file doesn't mark the fresh tab dirty and
        // queue a pointless write-back of what we just read.
        loadingRef.current = true;
        model.setValue(content);
        loadingRef.current = false;
      }

      // Show it ONLY if it is the file the user is actually looking at.
      //
      // This used to be unconditional, which is a race as soon as more than one file
      // is loading: restoring a session re-opens EVERY saved tab at once, so several
      // fetches are in flight and whichever lands LAST would seize the editor. The tab
      // bar said one file while the editor displayed another — and if that other one
      // was short or empty, it read as "my file lost its contents". React could not
      // correct it either: the `path` prop had not changed, so @monaco-editor/react
      // never re-attached. It only bit after a pause/resume, because reopening the
      // sandbox is the one flow that restores several tabs simultaneously.
      if (activePathRef.current !== path) return; // seeded; the tab will show it when selected

      editor.setModel(model);
      revealIfPending(path);
    });

    // Add to your cleanup logic
    editor.onDidDispose(() => {
      unsubscribeLoaded();
      // ... previous cleanup logic
    });


    // 3. Cleanup when component unmounts
    editor.onDidDispose(() => {
      disposablesRef.current.forEach(disposable => disposable.dispose());
      disposablesRef.current = [];
    });

  };

  // 2. Handle Text Changes
  const handleEditorChange: OnChange = (value, event) => {
    if (loadingRef.current) return; // seeding a model from the VFS, not a user edit
    if (activeFile) {
      // Monaco's deltas are 1-based and sorted end-to-start (safe to apply in
      // order); convert to 0-based LSP ranges for incremental language-server sync.
      const changes = event.changes.map((c) => ({
        range: {
          start: { line: c.range.startLineNumber - 1, character: c.range.startColumn - 1 },
          end: { line: c.range.endLineNumber - 1, character: c.range.endColumn - 1 },
        },
        text: c.text,
      }));
      eventBus.emit('CONTENT_CHANGED', {
        path: activeFile.path,
        newContent: value || '',
        isDirty: true,
        changes,
      });
    }
  };

  // 3. Update Font Settings when Global Settings change
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        fontFamily: globalSettings.fontFamily,
        fontSize: globalSettings.fontSize,
      });
    }
  }, [globalSettings]);

  // 3b. Keep the (mount-time) input manager pointed at the active file so its
  //     Ctrl+S emits SAVE_REQUESTED for the file actually on screen.
  useEffect(() => {
    inputManagerRef.current?.updateActivePath(activeFile?.path || '');
  }, [activeFile?.path]);

  // Empty State
  if (!activeFile) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-[#1e1e1e] text-[#8a8a8a] select-none">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-20">
          <path d="M12 2L2 12l10 10 10-10L12 2zm0 2.83L19.17 12 12 19.17 4.83 12 12 4.83z" />
        </svg>
        <p className="text-sm">Select a file to start coding</p>
        <div className="flex gap-4 mt-6 text-xs text-[#555555]">
          <span>Show Command Palette: <kbd className="bg-[#333] px-1 rounded">Ctrl+Shift+P</kbd></span>
          <span>Go to File: <kbd className="bg-[#333] px-1 rounded">Ctrl+P</kbd></span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full h-full relative">
      <Editor
        height="100%"
        path={activeFile.path} // Monaco uses this to maintain internal view states (cursor pos, undo history) across tabs!
        // Changing this calls monaco.editor.setModelLanguage on the live model, which
        // is what makes the picker retokenize the open file immediately.
        language={languageId ?? undefined}
        // No `value`: content is not React state. The model IS the buffer — seeded
        // by FILE_LOADED above, edited in place, and synced to disk by the VFS. A
        // `value` prop here would need every keystroke to round-trip through the
        // reducer to avoid reverting the buffer on tab switch.
        theme="cloud-ide-dark"
        onMount={handleEditorMount}
        onChange={handleEditorChange}
        options={{
          fontFamily: globalSettings.fontFamily,
          fontSize: globalSettings.fontSize,
          minimap: { enabled: false }, // Turn off minimap to keep it clean like your design
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          padding: { top: 16 }, // Give the text some breathing room from the tabs
          renderLineHighlight: 'all',
          // Files outside /workspace are a view into the container, not a buffer we
          // can save — there is no write route for them. Monaco blocks the edit so
          // the user finds out before typing, not on a save that silently no-ops.
          readOnly: !!activeFile.readOnly,
          readOnlyMessage: { value: 'This file is outside /workspace — read-only.' },
        }}
      />
    </div>
  );
};