import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceSession, FileNode } from '../types/editor';
import { LocalStorageManager } from '../utils/LocalStoragemanager';
import { isExternal } from '../core/VFSController';
import { toast, dialog } from '../../notifications';
import { pauseSandbox, restartSandbox, waitForRunning } from '../../api/sandbox';
import { navigate } from '../../pages/router';

import { EditorTabs } from './EditorTabs';
import { StatusBar } from './StatusBar';
import { TopNavBar } from './TopNavBar';
import { ActivityBar } from './ActivityBar';
import { FileExplorer } from './FileExplorer';
import { MonacoEditorWrapper } from './MonacoEditorWrapper';
import { ImageViewer } from './ImageViewer';
import { LanguagePicker } from './LanguagePicker';
import { CommandPalette } from './CommandPalette';
import { IDETerminal } from './IDETerminal';
import { NetworkPanel } from './NetworkPanel';
import { ComingSoon } from './ComingSoon';
import { PreviewPane } from '../../preview/PreviewPane';
import { DisplayPane } from '../../preview/DisplayPane';
import { VscSearch, VscExtensions, VscSettingsGear } from 'react-icons/vsc';

import { DesignSystemProvider, useDesignSystem } from '../context/DesignSystemContext';
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';

import { ContributionRegistry } from '../core/ContributionRegistry';
import { coreContributions } from '../contrib/coreContributions';

import { useWorkspaceBootstrap } from '../hooks/useWorkspaceBootstrap';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useLspStatus } from '../hooks/useLspStatus';
import { startPanelDrag } from '../hooks/usePanelResize';

interface EditorWorkspaceProps {
  session: WorkspaceSession;
}

// ==========================================
// INNER COMPONENT (inside the Workspace/DesignSystem providers)
// ==========================================
const EditorWorkspaceInner = ({ session }: EditorWorkspaceProps) => {
  const { sandboxId } = session;
  const { state: workspaceState, dispatch } = useWorkspace();
  const { settings } = useDesignSystem();

  // Non-visual engines: bus, VFS controller, LSP registry, live file tree.
  const { eventBus, fileTree, langRegistry, languages, flush } = useWorkspaceBootstrap(sandboxId);

  // Layout + per-sandbox persistence + drag resizing.
  const { layout, toggleSidebar, setSidebarWidth, setBottomPanelHeight } =
    useWorkspaceLayout(sandboxId);

  // Menus + activity items come from plugins (core built-ins first).
  const { menus, activityItems } = useMemo(() => {
    const reg = ContributionRegistry.from([coreContributions, ...(session.plugins ?? [])]);
    return { menus: reg.getMenus(), activityItems: reg.getActivityItems() };
  }, [session.plugins]);

  // Seed the workspace name. A warm handoff (env-manager → editor) provides it; a cold
  // reload / deep-link finds nothing (sessionStore is in-memory, not persisted), so fall
  // back to the sandbox id rather than leaving the header stuck on the "Loading Project…"
  // placeholder forever. ponytail: id, not the env name — SandboxStatus doesn't carry
  // environmentId; fetch it here if a prettier label is wanted.
  useEffect(() => {
    dispatch({ type: 'SET_WORKSPACE_NAME', payload: { name: session.workspaceName || sandboxId } });
  }, [session.workspaceName, sandboxId, dispatch]);

  // ---- Open-tab persistence: survive a page reload --------------------------
  // A refresh rebuilds this component from scratch, so the reducer starts with
  // zero open files and the editor comes up blank — the "reloading wiped my
  // files" report (the file BODIES were safe on disk; the open set was lost).
  // We snapshot the open paths to localStorage and replay them once the tree has
  // hydrated. `restored` gates the writer so the initial empty state can't
  // overwrite the saved set before we've had a chance to replay it.
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // Reset when switching sandboxes so we restore the right session.
    restoredRef.current = false;
    setRestored(false);
  }, [sandboxId]);

  useEffect(() => {
    const unsub = eventBus.on('VFS_TREE_UPDATED', ({ tree }) => {
      if (restoredRef.current) return;
      restoredRef.current = true;

      const session = LocalStorageManager.getSession(sandboxId);
      if (session.openFiles.length) {
        // Only re-open paths that still exist on disk (a file deleted between
        // sessions must not resurrect a broken tab).
        const present = new Set<string>();
        const walk = (nodes: FileNode[]) =>
          nodes.forEach((n) => {
            present.add(n.path);
            if (n.children) walk(n.children);
          });
        walk(tree);

        // An external file (stdlib, site-packages, /etc) is never in the tree —
        // the tree only mirrors the worktree — so the presence check can't speak
        // for it. Restore it anyway: the open path re-reads it from the container,
        // and a failed read now closes the tab on its own.
        const restorable = (p: string) => present.has(p) || isExternal(p);

        // FILE_OPEN_REQUESTED loads content + opens the tab (reusing the exact
        // path a user click takes), so every restored tab has a live buffer.
        session.openFiles
          .filter(restorable)
          .forEach((path) => eventBus.emit('FILE_OPEN_REQUESTED', { path }));

        if (session.activeFilePath && restorable(session.activeFilePath)) {
          eventBus.emit('TAB_ACTIVATED', { path: session.activeFilePath });
        }
      }
      setRestored(true);
    });
    return unsub;
  }, [eventBus, sandboxId]);

  useEffect(() => {
    if (!restored) return; // don't clobber the saved set before replaying it
    LocalStorageManager.saveSession(sandboxId, {
      openFiles: workspaceState.openFiles.map((f) => f.path),
      activeFilePath: workspaceState.activeFilePath,
    });
  }, [restored, sandboxId, workspaceState.openFiles, workspaceState.activeFilePath]);

  // Derive the active file for Monaco.
  const activeFile =
    workspaceState.openFiles.find((f) => f.path === workspaceState.activeFilePath) || null;

  // Manual language-mode overrides, per file path. detect() is a guess off the
  // filename, and the picker is how the user corrects it (an extensionless script, a
  // .txt that's really JSON). Not persisted — a reload re-detects. ponytail: hang it
  // off LocalStorageManager alongside the open-tab set if that turns out to annoy.
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, string>>({});
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  // Language of the active file, for the status bar AND Monaco — one resolution, so
  // the read-out can never disagree with what the editor is actually tokenizing.
  const activeLanguageId = activeFile
    ? languageOverrides[activeFile.path] ?? languages.detect(activeFile.path)
    : null;
  const activeLanguage = activeLanguageId ? languages.displayName(activeLanguageId) : null;
  // Live LSP connection state for that language (null if no server is wired).
  const lspStatus = useLspStatus(langRegistry, activeLanguageId);

  // Clicking the LSP read-out reports the real connection state, and retries the
  // connection when it's down — the one action available on an offline server.
  const handleLspClick = () => {
    const transport = activeLanguageId ? langRegistry.get(activeLanguageId) : undefined;
    if (!transport || !activeLanguage) return;

    if (lspStatus === 'connected') {
      toast.success(`${activeLanguage} language server is connected.`, { title: 'Language server' });
      return;
    }
    if (lspStatus === 'connecting') {
      toast.info(`Connecting to the ${activeLanguage} language server…`, { title: 'Language server' });
      return;
    }

    // offline — reconnect. connect() is documented safe to call repeatedly.
    toast.info(`Reconnecting to the ${activeLanguage} language server…`, { title: 'Language server' });
    transport.connect?.().catch((err: Error) =>
      toast.error(err.message, { title: `${activeLanguage} server unreachable` }),
    );
  };

  // Detach: flush dirty buffers, pause the sandbox (Scale-to-Zero), go home.
  // Non-destructive and reversible (reopen resumes the same container), so no
  // confirm dialog. One bus event serves both the top-bar button and File → Detach.
  const workspaceName = workspaceState.workspaceName;
  useEffect(() => {
    return eventBus.on('DETACH_REQUESTED', async () => {
      try {
        await flush(); // the writes MUST land before we leave — else they're lost
      } catch {
        toast.error('Could not save your changes — detach cancelled. Check your connection and retry.', {
          title: 'Detach',
        });
        return;
      }
      try {
        await pauseSandbox(sandboxId);
      } catch {
        // 409 = not running (already paused / stale record) — same end state, proceed.
      }
      navigate('/');
      toast.success(`Detached — ${workspaceName} paused`);
    });
  }, [eventBus, flush, sandboxId, workspaceName]);

  // Workspace restart: replace the container to apply boot-time changes (rebuilt
  // image, new egress allow-list). Files live on the host worktree and survive;
  // running processes don't — hence the confirm. The restart mints a NEW sandboxId
  // (recovery contract), so we navigate the editor onto it. One handler; entry
  // points: the top-bar button and the Allowed Hosts pane.
  useEffect(() => {
    return eventBus.on('WORKSPACE_RESTART_REQUESTED', async () => {
      const ok = await dialog.confirm({
        title: 'Restart workspace?',
        message:
          'The container is replaced to apply environment changes (rebuilt image, allowed hosts). ' +
          'Your files are kept; running processes and shells stop.',
        confirmLabel: 'Restart',
        danger: true,
      });
      if (!ok) return;

      try {
        await flush(); // pending edits must land before the container goes away
      } catch {
        toast.error('Could not save your changes — restart cancelled.', { title: 'Workspace' });
        return;
      }

      toast.info('Restarting workspace…', { title: 'Workspace' });
      try {
        const { sandboxId: newId } = await restartSandbox(sandboxId);
        await waitForRunning(newId);
        navigate(`/editor/${encodeURIComponent(newId)}`);
        toast.success('Workspace restarted — environment changes are live.', { title: 'Workspace' });
      } catch (e) {
        toast.error((e as Error).message, { title: 'Restart failed' });
      }
    });
  }, [eventBus, flush, sandboxId]);

  // A dev server the user started in the terminal, proxied through the Gateway's
  // ingress so the browser can actually reach it (the container's localhost can't
  // be reached from here). Null = no preview open.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // The interactive Display pane (virtual X screen). Shares the right-hand split
  // with the preview — one side pane at a time in v1, so opening either closes
  // the other.
  const [displayOpen, setDisplayOpen] = useState(false);
  useEffect(() => {
    return eventBus.on('DISPLAY_TOGGLE_REQUESTED', () => {
      setDisplayOpen((open) => {
        if (!open) setPreviewUrl(null);
        return !open;
      });
    });
  }, [eventBus]);
  const openPreview = (url: string) => {
    setDisplayOpen(false);
    setPreviewUrl(url);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-ide-bg text-ide-text font-sans overflow-hidden">
      {/* Quick-open overlay (Ctrl+P). Bus-driven; renders nothing until opened. */}
      <CommandPalette files={fileTree} eventBus={eventBus} />

      {/* ZONE 1: TOP NAVIGATION */}
      <TopNavBar
        menus={menus}
        activeFilePath={workspaceState.activeFilePath}
        workspaceName={workspaceState.workspaceName}
        eventBus={eventBus}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* ZONE 2: ACTIVITY BAR */}
        <ActivityBar
          items={activityItems}
          activePanel={layout.sidebarOpen ? layout.activeSidebarPanel : null}
          onPanelSelect={toggleSidebar}
          syncStatus={workspaceState.syncStatus}
        />

        {/* ZONE 3: SIDEBAR & HORIZONTAL RESIZER */}
        {layout.sidebarOpen && (
          <>
            <div
              style={{ width: `${layout.sidebarWidth}px` }}
              className="flex flex-col flex-shrink-0 bg-ide-panel border-r border-ide-border overflow-hidden"
            >
              {layout.activeSidebarPanel === 'explorer' && (
                <FileExplorer
                  workspaceName={workspaceState.workspaceName}
                  files={fileTree}
                  activeFilePath={workspaceState.activeFilePath}
                  eventBus={eventBus}
                />
              )}
              {layout.activeSidebarPanel === 'network' && (
                <NetworkPanel sandboxId={sandboxId} eventBus={eventBus} />
              )}
              {layout.activeSidebarPanel === 'search' && (
                <ComingSoon
                  icon={<VscSearch size={20} />}
                  title="Search"
                  description="Full-text search across your workspace files is on the way."
                />
              )}
              {layout.activeSidebarPanel === 'plugins' && (
                <ComingSoon
                  icon={<VscExtensions size={20} />}
                  title="Plugins"
                  description="Browse and manage editor extensions. Not available yet."
                />
              )}
              {layout.activeSidebarPanel === 'settings' && (
                <ComingSoon
                  icon={<VscSettingsGear size={20} />}
                  title="Settings"
                  description="Editor and workspace preferences will live here soon."
                />
              )}
            </div>

            {/* Sidebar resizer handle */}
            <div
              onMouseDown={(e) =>
                startPanelDrag(e, {
                  axis: 'x',
                  initial: layout.sidebarWidth,
                  min: 150,
                  max: 600,
                  onResize: setSidebarWidth,
                })
              }
              className="w-2 cursor-col-resize bg-ide-border hover:bg-ide-accent z-50 transition-colors shrink-0"
            />
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 bg-ide-bg">
          {/* ZONE 4: EDITOR SURFACE */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <EditorTabs
              activeFilePath={workspaceState.activeFilePath}
              openFiles={workspaceState.openFiles}
              eventBus={eventBus}
            />
            <div className="flex flex-1 min-h-0">
              <div className="relative flex-1 min-w-0">
                <MonacoEditorWrapper
                  activeFile={activeFile}
                  globalSettings={settings}
                  eventBus={eventBus}
                  registry={langRegistry}
                  languages={languages}
                  languageId={activeLanguageId}
                />
                {/* An image tab covers Monaco rather than replacing it — swapping the
                    component out would tear down and rebuild the editor (and every
                    model's undo history) on each hop between a PNG and a source file. */}
                {activeFile?.isImage && (
                  <ImageViewer sandboxId={sandboxId} path={activeFile.path} />
                )}
              </div>

              {displayOpen ? (
                <div className="w-1/2 min-w-0 shrink-0">
                  <DisplayPane sandboxId={sandboxId} onClose={() => setDisplayOpen(false)} />
                </div>
              ) : (
                previewUrl && (
                  <div className="w-1/2 min-w-0 shrink-0">
                    <PreviewPane url={previewUrl} onClose={() => setPreviewUrl(null)} />
                  </div>
                )
              )}
            </div>
          </div>

          {/* ZONE 5: TERMINAL & VERTICAL RESIZER */}
          {layout.bottomPanelOpen && (
            <>
              {/* Terminal resizer handle — invert: dragging the top edge up grows it. */}
              <div
                onMouseDown={(e) =>
                  startPanelDrag(e, {
                    axis: 'y',
                    initial: layout.bottomPanelHeight,
                    min: 100,
                    max: 800,
                    invert: true,
                    onResize: setBottomPanelHeight,
                  })
                }
                className="h-2 cursor-row-resize bg-ide-border hover:bg-ide-accent z-50 transition-colors shrink-0"
              />

              <div
                style={{ height: `${layout.bottomPanelHeight}px` }}
                className="bg-ide-panel flex flex-col flex-shrink-0"
              >
                <IDETerminal
                  sandboxId={sandboxId}
                  editorEventBus={eventBus}
                  onPreview={openPreview}
                />
              </div>
            </>
          )}

          {/* ZONE 6: STATUS BAR. ponytail: cursor/formatting/git are still mock —
              real wiring is a separate feature (see REFACTOR.md deferred list). */}
          <StatusBar
            settings={settings}
            cursor={{ line: 5, column: 36 }}
            formatting={{ eol: 'LF', encoding: 'UTF8', indentMode: 'spaces', indentSize: 2 }}
            git={{ branch: 'main', hasChanges: false }}
            language={activeLanguage}
            lsp={lspStatus}
            onLspClick={handleLspClick}
            onLanguageClick={() => setLanguagePickerOpen(true)}
          />

          {languagePickerOpen && activeFile && (
            <LanguagePicker
              languages={languages.list()}
              current={activeLanguageId}
              onSelect={(id) =>
                setLanguageOverrides((prev) => ({ ...prev, [activeFile.path]: id }))
              }
              onClose={() => setLanguagePickerOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// EXPORTED WRAPPER (injects the providers)
// ==========================================
export const EditorWorkspace = (props: EditorWorkspaceProps) => (
  <DesignSystemProvider>
    <WorkspaceProvider>
      <EditorWorkspaceInner {...props} />
    </WorkspaceProvider>
  </DesignSystemProvider>
);
