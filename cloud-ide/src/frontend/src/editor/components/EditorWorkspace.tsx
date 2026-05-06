import React, { useState, useEffect, useRef, useMemo } from 'react';
import { EditorTabs } from './EditorTabs';
import { IDEGlobalSettings, TopMenuCategory, SyncStatus } from '../types/editor';
import { StatusBar } from './StatusBar';
import { TopNavBar } from './TopNavBar';
import { ActivityBarItem } from '../types/editor';
import { ActivityBar } from './ActivityBar';
import { FileNode } from '../types/editor';
import { FileExplorer } from './FileExplorer';
import { MonacoEditorWrapper } from './MonacoEditorWrapper';
import { LanguageRegistry } from '../core/EditorRegistry';
import { AVAILABLE_PLUGINS } from '../plugins/PluginManifest';
// import { EditorEventBus } from './core/EditorEventBus';
// import { IVirtualFileSystem } from './types/editor';
// --- NEW CORE IMPORTS ---
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';
import { EditorEventBus } from '../core/EditorEventBus';
import { VFSController } from '../core/VFSController';

// ==========================================
// MOCK CONFIGURATION (Keep these outside the component)
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

const MOCK_FILES: FileNode[] = [
  {
    name: 'cogs', path: '/cogs', type: 'directory',
    children: [
      { name: 'music.py', path: '/cogs/music.py', type: 'file' },
      { name: 'moderation.py', path: '/cogs/moderation.py', type: 'file' }
    ]
  },
  { name: 'bot.py', path: '/bot.py', type: 'file' },
  { name: '.env', path: '/.env', type: 'file' },
  { name: 'README.md', path: '/README.md', type: 'file' },
  { name: '.gitignore', path: '/.gitignore', type: 'file' }
];

interface WorkspaceLayoutState {
  sidebarOpen: boolean;
  activeSidebarPanel: string;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
}

interface EditorWorkspaceProps {
  sandboxId: string;
}

const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  sidebarOpen: true,
  activeSidebarPanel: 'explorer',
  bottomPanelOpen: true,
  bottomPanelHeight: 250,
};

// ==========================================
// INNER COMPONENT (Has access to Workspace Context)
// ==========================================
const EditorWorkspaceInner = ({ sandboxId }: EditorWorkspaceProps) => {
  const storageKey = `ide-layout-state-${sandboxId}`;
  
  // 1. Hook into our new UI State Engine
  const { state: workspaceState, dispatch } = useWorkspace();

  // 2. Instantiate the Central Event Bus exactly ONCE
  const eventBus = useMemo(() => new EditorEventBus(), []);

  // 3. Boot the Virtual File System Controller
  useEffect(() => {
    // The VFS starts listening to the eventBus immediately.
    // When you click a file in the sidebar, it fetches the data and injects it into Monaco!
    const vfs = new VFSController(eventBus, dispatch);
  }, [eventBus, dispatch]);

  // 4. Dynamically Load Plugins from the Manifest
  const langRegistry = useMemo(() => {
    const reg = new LanguageRegistry();
    AVAILABLE_PLUGINS.forEach(PluginClass => {
      reg.register(new PluginClass());
    });
    return reg;
  }, []);

  // 5. Layout State Hydration
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUT;
    } catch {
      return DEFAULT_LAYOUT;
    }
  });

  useEffect(() => {
    const handleBeforeUnload = () => localStorage.setItem(storageKey, JSON.stringify(layout));
    localStorage.setItem(storageKey, JSON.stringify(layout));
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [layout, storageKey]);

  const toggleSidebar = (panel: string) => {
    setLayout(prev => {
      if (prev.activeSidebarPanel === panel && prev.sidebarOpen) {
        return { ...prev, sidebarOpen: false };
      }
      return { ...prev, sidebarOpen: true, activeSidebarPanel: panel };
    });
  };

  // Derive active file for Monaco (Note: content is no longer tracked here, saving RAM!)
  const activeFile = workspaceState.openFiles.find(
    (f) => f.path === workspaceState.activeFilePath
  ) || null;


  // Add a safe fallback
  // TODO: make this system more robust by enforcing that settings are always present in the context (even if it's just defaults)
  const safeSettings = workspaceState.globalSettings || {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    theme: 'dark'
  };
  return (
    <div className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] font-sans overflow-hidden">
      {/* ZONE 1: TOP NAVIGATION */}
      <TopNavBar 
        menus={DEFAULT_MENUS}
        activeFileName={workspaceState.activeFilePath?.split('/').pop()} 
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

        {/* ZONE 3: SIDEBAR */}
        {layout.sidebarOpen && (
          <FileExplorer 
            workspaceName={workspaceState.workspaceName}
            files={MOCK_FILES}
            activeFilePath={workspaceState.activeFilePath}
            eventBus={eventBus}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
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
                globalSettings={safeSettings}
                eventBus={eventBus}
                registry={langRegistry} 
              />
            </div>
          </div>

          {/* ZONE 5: TERMINAL */}
          {layout.bottomPanelOpen && (
            <div 
              style={{ height: `${layout.bottomPanelHeight}px` }}
              className="border-t border-[#333333] bg-[#1e1e1e] flex flex-col flex-shrink-0"
            >
              {/* Drop Terminal Here */}
            </div>
          )}

          {/* ZONE 6: STATUS BAR */}
          <StatusBar 
            settings={safeSettings}
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
    <WorkspaceProvider>
      <EditorWorkspaceInner {...props} />
    </WorkspaceProvider>
  );
};