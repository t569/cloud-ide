// frontend/src/editor/components/MonacoEditorWrapper.tsx
import React, { useRef, useEffect } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
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
}

export const MonacoEditorWrapper = ({ activeFile, globalSettings, eventBus, registry, languages }: MonacoEditorProps) => {
  const editorRef = useRef<any>(null);
  const disposablesRef = useRef<any[]>([]); // Track disposables for cleanup
  // Latest settings, readable from the (mount-time) input manager closure.
  const settingsRef = useRef(globalSettings);
  settingsRef.current = globalSettings;


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

    // 2. Install all language services (completion/hover/...) via their monaco
    //    bridges. The registry owns the transports; this call is UI-only.
    disposablesRef.current.push(...registry.install(monaco));

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

    // Listen for incoming file data from the VFS
    const unsubscribeLoaded = eventBus.on('FILE_LOADED', ({ path, content, language }) => {
      // Check if a model for this file already exists in Monaco's memory
      let model = monaco.editor.getModel(monaco.Uri.parse(path));
      
      if (!model) {
        // Create a new text buffer for this file
        model = monaco.editor.createModel(content, language, monaco.Uri.parse(path));
      }
      
      // Tell the editor to display this model
      editor.setModel(model);
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
        language={languages.detect(activeFile.path)}
        value={activeFile.content} // NOTE: You will need to add 'content' to your mock state to test this
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
        }}
      />
    </div>
  );
};