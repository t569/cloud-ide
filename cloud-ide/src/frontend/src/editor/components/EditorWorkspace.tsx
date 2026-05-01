import React, { useState, useEffect, useRef, useMemo } from 'react';
import { EditorTabs } from './EditorTabs';
import { IDEGlobalSettings, TopMenuCategory, SyncStatus } from '../types/editor';
import { StatusBar } from './StatusBar';
import { TopNavBar } from './TopNavBar';
import { ActivityBarItem } from '../types/editor';
import { ActivityBar } from './ActivityBar';
// import { EditorEventBus } from './core/EditorEventBus';
// import { IVirtualFileSystem } from './types/editor';


// TODO: we will also need to implement this interface to manage the state of the workspace 
// (open files, active file, sync status, etc.) 
// and pass it down to the relevant components like EditorTabs and StatusBar. 
// This will likely involve setting up a context provider 
// or using a state management library for better scalability as the app grows.
// Mock Menu Configuration
const DEFAULT_MENUS: TopMenuCategory[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { id: 'new-file', label: 'New File', shortcut: 'Ctrl+N' },
      { id: 'open-file', label: 'Open File...', shortcut: 'Ctrl+O' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: 'SAVE_REQUESTED' },
      { id: 'save-all', label: 'Save All', shortcut: 'Ctrl+K S' }
    ]
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
      { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
      { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' }
    ]
  },
  // You can easily add 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help' following this pattern
];

// Mock Activity Bar Registry (Plugins can push to this array)
const DEFAULT_ACTIVITY_ITEMS: ActivityBarItem[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    position: 'top',
    // Folder Outline SVG matching your design
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 8.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
  },
  {
    id: 'search',
    title: 'Search',
    position: 'top',
    // Magnifying Glass SVG
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
  },
  {
    id: 'plugins',
    title: 'Plugins & Extensions',
    position: 'top',
    // Grid SVG
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
  },
  {
    id: 'settings',
    title: 'Settings',
    position: 'bottom',
    // Gear SVG
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  }
];

interface WorkspaceLayoutState {
  sidebarOpen: boolean;
  activeSidebarPanel: string;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
}

// 1. Define the props for the workspace
interface EditorWorkspaceProps {
  sandboxId: string;
}

interface WorkspaceState {
  activeFilePath: string | null;
  openFiles: { path: string; isDirty: boolean }[];
  syncStatus: SyncStatus;
}

const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  sidebarOpen: true,
  activeSidebarPanel: 'explorer',
  bottomPanelOpen: true,
  bottomPanelHeight: 250, // pixels
};

// 2. Apply the interface to the component
export const EditorWorkspace = ({ sandboxId }: EditorWorkspaceProps) => {
  // 1. Initialize the Central Event Bus
  // const eventBus = useMemo(() => new EditorEventBus(), []);
  
  const storageKey = `ide-layout-state-${sandboxId}`;

  // 2. Layout State Management (with LocalStorage Hydration)
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUT;
    } catch {
      return DEFAULT_LAYOUT;
    }
  });

  // FIX: Mocking the Workspace State so EditorTabs has data to render
  // TODO: chnage this to be dynamic based on actual file opening/closing actions in the workspace
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    activeFilePath: '/src/bot.py',
    openFiles: [
      { path: '/src/bot.py', isDirty: false },
      { path: '/src/.env', isDirty: true },
    ],
    syncStatus: 'synced'
  });

  // Mocking the data for now so it compiles
  const [globalSettings] = useState<IDEGlobalSettings>({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    theme: 'dark'
 });
  
  // FIX: Mocking the Event Bus to satisfy TypeScript
  const eventBus = useMemo(() => ({
    emit: (event: string, payload: any) => {
      console.log(`[EventBus] ${event}`, payload);
      // Temporary logic just so you can see the tabs working
      if (event === 'TAB_ACTIVATED') {
        setWorkspaceState(prev => ({ ...prev, activeFilePath: payload.path }));
      }
      if (event === 'TAB_CLOSED') {
        setWorkspaceState(prev => ({
          ...prev,
          openFiles: prev.openFiles.filter(f => f.path !== payload.path),
          activeFilePath: prev.activeFilePath === payload.path ? null : prev.activeFilePath
        }));
      }
    }
  }), []);

  // 3. Persist Layout State on Change or Unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    };

    // Save immediately on layout change to ensure we don't lose it
    localStorage.setItem(storageKey, JSON.stringify(layout));
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [layout, storageKey]);



  // Layout mutators
  const toggleSidebar = (panel: string) => {
    setLayout(prev => {
      if (prev.activeSidebarPanel === panel && prev.sidebarOpen) {
        return { ...prev, sidebarOpen: false };
      }
      return { ...prev, sidebarOpen: true, activeSidebarPanel: panel };
    });
  };

  return (
    /* MASTER CONTAINER: Full screen, prevents scrolling on body */
    <div className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] font-sans overflow-hidden">
      
      {/* ---------------------------------------------------------
          ZONE 1: TOP NAVIGATION BAR
          --------------------------------------------------------- */}
      <TopNavBar 
  menus={DEFAULT_MENUS}
  // Grabbing just the filename from the path to match the image format
  activeFileName={workspaceState.activeFilePath?.split('/').pop()} 
  workspaceName="API Docs - Diamond"
  eventBus={eventBus}
/>
      {/* MIDDLE SECTION: Contains Activity Bar, Sidebar, and Editor/Terminal */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* ---------------------------------------------------------
            ZONE 2: ACTIVITY BAR (Far Left Icons)
            --------------------------------------------------------- */}
        <ActivityBar 
            items={DEFAULT_ACTIVITY_ITEMS}
            activePanel={layout.sidebarOpen ? layout.activeSidebarPanel : null}
            onPanelSelect={toggleSidebar}
            syncStatus={workspaceState.syncStatus} 
            />

        {/* ---------------------------------------------------------
            ZONE 3: SIDEBAR (File Tree / Search)
            --------------------------------------------------------- */}
        {layout.sidebarOpen && (
          <div className="w-64 flex-shrink-0 bg-[#252526] border-r border-[#1e1e1e] flex flex-col">
            <div className="h-8 flex items-center px-4 text-xs uppercase tracking-wider text-gray-400 font-semibold">
              {layout.activeSidebarPanel}
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Drop FileExplorer or SearchWidget Components Here */}
              <div className="p-4 text-sm text-gray-500 italic">Panel Content...</div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------
            MAIN CONTENT AREA (Editor + Terminal)
            --------------------------------------------------------- */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          
          {/* ZONE 4: EDITOR SURFACE */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            
            {/* Editor Tab Manager */}
            <EditorTabs 
                activeFilePath={workspaceState.activeFilePath} 
                openFiles={workspaceState.openFiles} 
                eventBus={eventBus} 
                />

            {/* Actual Monaco Editor Mount Point */}
            <div className="flex-1 relative">
               {/* Drop MonacoEditorWrapper Here */}
            </div>
          </div>

          {/* ZONE 5: BOTTOM PANEL (Terminal Integration) */}
            {layout.bottomPanelOpen && (
            <div 
                style={{ height: `${layout.bottomPanelHeight}px` }}
                className="border-t border-[#333333] bg-[#1e1e1e] flex flex-col flex-shrink-0"
            >
                {/* Terminal Content Here */}
            </div>
            )}
            {/* ZONE 6: THE STATUS BAR (Absolute Bottom of the screen) */}
            <StatusBar 
            settings={globalSettings}
            cursor={{ line: 5, column: 36 }}
            formatting={{ eol: 'LF', encoding: 'UTF8', indentMode: 'spaces', indentSize: 2 }}
            git={{ branch: 'main', hasChanges: false }}
            />

            </div> {/* End of MASTER CONTAINER */}
      </div>
    </div>
  );
};