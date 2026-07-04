import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { EditorTabs } from './EditorTabs';
import { IDEGlobalSettings, TopMenuCategory, SyncStatus } from '../types/editor';
import { StatusBar } from './StatusBar';
import { TopNavBar } from './TopNavBar';
import { ActivityBarItem } from '../types/editor';
import { ActivityBar } from './ActivityBar';
import { FileNode } from '../types/editor';
import { FileExplorer } from './FileExplorer';
import { useDesignSystem } from '../context/DesignSystemContext';
import { DesignSystemProvider } from '../context/DesignSystemContext';
import { MonacoEditorWrapper } from './MonacoEditorWrapper';
import { LanguageServiceRegistry, createLanguageTransports } from '../lsp';

// TERMINAL
import { IDETerminal } from './IDETerminal';

// --- NEW CORE IMPORTS ---
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';
import { EditorEventBus } from '../core/EditorEventBus';
import { VFSController } from '../core/VFSController';
import { LocalStorageManager } from '../utils/LocalStoragemanager';

// WORK SPACE STATE
import { WorkspaceLayoutState } from '../types/editor';


// TERMINAL
// TODO: remember to sync the backend with chokidar
/**
 * B. Active Backend Mutations (Git, NPM, Touch): This requires Backend Daemon support.
Your frontend terminal cannot know if npm install changed 10,000 files.

What you need to do: In your Docker container/sandbox backend, you must run a lightweight file-watcher (like chokidar in Node or inotify in Linux). 
When the disk changes, the backend sends a WebSocket message to the frontend: { type: 'FS_EVENT', action: 'reload_tree' }. 
Your VFSController listens for this WebSocket message and triggers vfs.hydrateWorkspace() to fetch the new files.
 */

// ==========================================
// MOCK CONFIGURATION 
// ==========================================
const DEFAULT_MENUS: TopMenuCategory[] = [
  {
    id: 'file', label: 'File',
    items: [
      { id: 'new-file', label: 'New File', shortcut: 'Ctrl+N' },
      { id: 'open-file', label: 'Open File...', shortcut: 'Ctrl+O' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: 'SAVE_REQUESTED' },
      { id: 'save-all', label: 'Save All', shortcut: 'Ctrl+K S' }
    ]
  },
  {
    id: 'edit', label: 'Edit',
    items: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
      { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
      { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' }
    ]
  }
];

const DEFAULT_ACTIVITY_ITEMS: ActivityBarItem[] = [
  {
    id: 'explorer', title: 'Explorer', position: 'top',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 8.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
  },
  {
    id: 'search', title: 'Search', position: 'top',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
  },
  {
    id: 'plugins', title: 'Plugins', position: 'top',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
  },
  {
    id: 'settings', title: 'Settings', position: 'bottom',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  }
];

interface EditorWorkspaceProps {
  sandboxId: string;
}

// ==========================================
// INNER COMPONENT (Has access to Workspace Context)
// ==========================================
const EditorWorkspaceInner = ({ sandboxId }: EditorWorkspaceProps) => {
  const storageKey = `ide-layout-state-${sandboxId}`;
  
  // 1. Hook into our UI State Engines
  const { state: workspaceState, dispatch } = useWorkspace();
  const { settings } = useDesignSystem();
  
  // NEW: Dynamic File Tree State
  const [fileTree, setFileTree] = useState<FileNode[]>([]);

  // 2. Instantiate the Central Event Bus exactly ONCE
  const eventBus = useMemo(() => new EditorEventBus(), []);

  // 3. Boot the Virtual File System Controller
  useEffect(() => {
    // 3a. Listen for tree updates BEFORE booting to ensure we catch the hydration payload!
    const unsubTree = eventBus.on('VFS_TREE_UPDATED', (payload) => {
      setFileTree(payload.tree);
    });

    const vfs = new VFSController(eventBus, dispatch, sandboxId);
    vfs.initWorkspace();

    return () => {
      unsubTree();
      vfs.destroy();
    }
  }, [eventBus, dispatch, sandboxId]);

  // 4. Build the language-service registry from the manifest. Each transport is
  //    a swappable backend (mock, WebSocket, your own) — see lsp/manifest.ts.
  const langRegistry = useMemo(() => {
    const reg = new LanguageServiceRegistry();
    createLanguageTransports(/* sandboxId */).forEach(t => reg.register(t));
    return reg;
  }, []);

  // Tear down transports (close sockets) when the workspace unmounts.
  useEffect(() => () => langRegistry.dispose(), [langRegistry]);

  // ==========================================
  // LAYOUT & PERSISTENCE ENGINE
  // ==========================================
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => {
    const saved = LocalStorageManager.getWorkspaceState(sandboxId);
    return { ...saved, sidebarWidth: saved.sidebarWidth || 250 };
  });

  useEffect(() => {
    LocalStorageManager.saveWorkspaceState(sandboxId, layout);
  }, [layout, sandboxId]);

  const toggleSidebar = (panel: string) => {
    setLayout(prev => {
      if (prev.activeSidebarPanel === panel && prev.sidebarOpen) {
        return { ...prev, sidebarOpen: false };
      }
      return { ...prev, sidebarOpen: true, activeSidebarPanel: panel };
    });
  };

  // ==========================================
  // DRAG RESIZING LOGIC
  // ==========================================
  const startSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = layout.sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(startWidth + (moveEvent.clientX - startX), 600));
      setLayout(prev => ({ ...prev, sidebarWidth: newWidth }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'default'; 
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [layout.sidebarWidth]);

  const startTerminalDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = layout.bottomPanelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(startHeight - (moveEvent.clientY - startY), 800));
      setLayout(prev => ({ ...prev, bottomPanelHeight: newHeight }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'default';
    };

    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [layout.bottomPanelHeight]);

  // Derive active file for Monaco
  const activeFile = workspaceState.openFiles.find(
    (f) => f.path === workspaceState.activeFilePath
  ) || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-ide-bg text-ide-text font-sans overflow-hidden">
      {/* ZONE 1: TOP NAVIGATION */}
      <TopNavBar 
        menus={DEFAULT_MENUS}
        activeFilePath={workspaceState.activeFilePath} 
        workspaceName={workspaceState.workspaceName}
        eventBus={eventBus}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* ZONE 2: ACTIVITY BAR */}
        <ActivityBar 
          items={DEFAULT_ACTIVITY_ITEMS}
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
                  files={fileTree} // <--- NOW PASSING DYNAMIC VFS STATE
                  activeFilePath={workspaceState.activeFilePath}
                  eventBus={eventBus}
                />
              )}
              {layout.activeSidebarPanel === 'search' && (
                <div className="p-4 text-sm text-ide-muted">Search Panel (WIP)</div>
              )}
            </div>

            {/* The Sidebar Resizer Handle */}
            <div 
              onMouseDown={startSidebarDrag}
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
            <div className="flex-1 relative">
              <MonacoEditorWrapper 
                activeFile={activeFile}
                globalSettings={settings}
                eventBus={eventBus}
                registry={langRegistry} 
              />
            </div>
          </div>

          {/* ZONE 5: TERMINAL & VERTICAL RESIZER */}
          {layout.bottomPanelOpen && (
            <>
              {/* The Terminal Resizer Handle */}
              <div 
                onMouseDown={startTerminalDrag}
                className="h-2 cursor-row-resize bg-ide-border hover:bg-ide-accent z-50 transition-colors shrink-0"
              />
              
              <div 
                style={{ height: `${layout.bottomPanelHeight}px` }}
                className="bg-ide-panel flex flex-col flex-shrink-0"
              >
                <IDETerminal 
                  sandboxId={sandboxId}
                  editorEventBus={eventBus}
                />
              </div>
            </>
          )}

          {/* ZONE 6: STATUS BAR */}
          <StatusBar 
            settings={settings}
            cursor={{ line: 5, column: 36 }}
            formatting={{ eol: 'LF', encoding: 'UTF8', indentMode: 'spaces', indentSize: 2 }}
            git={{ branch: 'main', hasChanges: false }}
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// EXPORTED WRAPPER (Injects the Provider)
// ==========================================
export const EditorWorkspace = (props: EditorWorkspaceProps) => {
  return (
    <DesignSystemProvider>
      <WorkspaceProvider>
        <EditorWorkspaceInner {...props} />
      </WorkspaceProvider>
    </DesignSystemProvider>
  );
};