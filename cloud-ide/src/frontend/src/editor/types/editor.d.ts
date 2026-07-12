// frontend/src/editor/types/editor.d.ts
/**
 * This file defines the core TypeScript types and interfaces for our Cloud IDE's editor component.
 * It includes global settings, status bar metadata, menu structures, VFS contracts, event payloads, 
 * and snapshot traits. This serves as the single source of truth for all type definitions related to the editor.
 */
import { SyncStatus } from '../../vfs/types/vfs';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { ContentChange } from '../lsp/types';


export type {SyncStatus};
/**
 * ==========================================
 * GLOBAL IDE SETTINGS
 * ==========================================
 */
export interface IDEGlobalSettings {
  fontFamily: string;      // e.g., "'JetBrains Mono', monospace"
  fontSize: number;        // Global UI font size (Monaco and Terminal might have overrides)
  theme: 'dark' | 'light';
  formatOnSave: boolean;   // Run the format command before each save
}

/**
 * ==========================================
 * STATUS BAR METADATA
 * ==========================================
 */
export interface EditorCursorState {
  line: number;
  column: number;
}

export interface DocumentFormatting {
  eol: 'LF' | 'CRLF';
  encoding: string;        // e.g., 'UTF8'
  indentMode: 'spaces' | 'tabs';
  indentSize: number;      // e.g., 2 or 4
}

export interface GitState {
  branch: string;          // e.g., 'main'
  hasChanges: boolean;
}

/**
 * ==========================================
 * TOP NAVIGATION MENU
 * ==========================================
 */
export interface MenuItemNode {
  id: string;
  label: string;
  shortcut?: string;           // e.g., 'Ctrl+S'
  action?: EditorEventType;    // Connects directly to our Event Bus
  payload?: any;               // Data to pass with the action
  isDivider?: boolean;
  disabled?: boolean;
  subMenu?: MenuItemNode[];    // Supports nested dropdowns
}

export interface TopMenuCategory {
  id: string;
  label: string;
  items: MenuItemNode[];
}

/**
 * ==========================================
 * ACTIVITY BAR (FAR LEFT SIDEBAR)
 * ==========================================
 */
export interface ActivityBarItem {
  id: string;                  // e.g., 'explorer', 'search', 'github'
  title: string;               // Tooltip text
  icon: React.ReactNode;       // The SVG or icon component
  position: 'top' | 'bottom';
  action?: EditorEventType;    // Optional: emit an event instead of just opening a panel
}

/**
 * ==========================================
 * 1. THE VIRTUAL FILE SYSTEM (VFS)
 * ==========================================
 * Handles all file operations. The UI strictly uses this interface, 
 * meaning you can swap a LocalBrowserVFS for a GitHubVFS or SandboxVFS 
 * later without changing a single line of React code.
 */

export interface FileNode {
  name: string;
  path: string;       // Absolute path within the workspace (e.g., '/src/utils.js')
  type: 'file' | 'directory';
  extension?: string; // Useful for the Icon Engine (e.g., 'js', 'ts', 'md')
  children?: FileNode[]; // Only populated if type === 'directory'
}

// state tracked in the EditorWorkspace component related to layout (e.g., sidebar open/closed, active panel, bottom panel height)
export interface WorkspaceLayoutState {
  sidebarOpen: boolean;
  activeSidebarPanel: string; // e.g., 'explorer', 'search'
  sidebarWidth: number; // in pixels
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;  // in pixels
}

/**
 * ==========================================
 * 2. THE EVENT BUS PAYLOADS
 * ==========================================
 * Defines the strict mapping between Editor events and their payloads.
 * This is your central nervous system. The TopNav, Sidebar, and Editor 
 * communicate by emitting these events, completely avoiding prop-drilling.
 */

export interface EditorEventPayloads {
  /** Fired when a user clicks a file in the Explorer. */
  'FILE_OPEN_REQUESTED': { path: string };

  /** Fired when the VFS successfully loads the file and it's ready for Monaco. */
  'FILE_LOADED': { path: string; content: string; language: string };

  // --- [PATCHED] NEW CRUD EVENTS ---
  'FILE_CREATED': { path: string; type: 'file' | 'directory' };
  'FILE_DELETED': { path: string };
  'FILE_RENAMED': { oldPath: string; newPath: string };

  /** Fired when a user closes a tab in the Top Display. */
  'TAB_CLOSED': { path: string };

  /** Fired when a user switches between already-open tabs. */
  'TAB_ACTIVATED': { path: string };

  /** Fired by Monaco on keystroke. Triggers the 'dirty' dot on the UI tab.
   *  `changes` carries Monaco's incremental edit deltas (0-based, LSP-shaped) for
   *  live language-server sync; absent when emitted by non-Monaco sources. */
  // [PATCHED] isDirty is now optional so the Test Harness doesn't throw errors!
  'CONTENT_CHANGED': { path: string; newContent: string; isDirty?: boolean; changes?: ContentChange[] };

  /** Fired by Ctrl+S or the TopNav File -> Save button. */
  'SAVE_REQUESTED': { path: string };

  /** Fired by the VFS to update the Traffic Light UI (Sidebar). */
  'SYNC_STATUS_CHANGED': { status: SyncStatus };

  /** Fired when a file/folder is created or deleted, prompting the Explorer to re-render. */
  'TREE_UPDATED': { rootNode: FileNode };

  /** Fired by the VFS engine whenever the memory map changes so the UI can rebuild the tree */
  'VFS_TREE_UPDATED': { tree: FileNode[] };

  // --- Snapshot Events ---
  'SNAPSHOT_CREATE_REQUESTED': { ttlSeconds?: number }; 
  'SNAPSHOT_CREATED': { shareableUrl: string; snapshot: WorkspaceSnapshot };
  'SNAPSHOT_LOAD_REQUESTED': { snapshotId: string };

  // --- EDITOR COMMANDS ---
  'COMMAND_FORMAT': { path: string };
  'COMMAND_PALETTE': {};

  // NOTE: Language-server requests (completion/hover/...) do NOT go through the
  // event bus — they are request/response and are handled by the transport port
  // in `editor/lsp/`. The bus is for one-way notifications only.
}

export type EditorEventType = keyof EditorEventPayloads;

/**
 * ==========================================
 * 3. STATE & DATA MODELS
 * ==========================================
 */

export interface OpenFileContext {
  path: string;
  isDirty: boolean;
  isDeleted?: boolean; // New flag to indicate if the file has been deleted from the VFS
  // NOTE: no `content` — a file's text lives in its Monaco model (seeded by
  // FILE_LOADED) and in the VFS map, never in React state. A vestigial `content`
  // field here is what made the editor pass `value={undefined}` to Monaco.
  // Set for files outside /workspace: they live only in the container, are not in
  // the worktree (so not in git), and have no write route. Monaco enforces it.
  readOnly?: boolean;
  /** An image: rendered by ImageViewer, not Monaco (see isImage). */
  isImage?: boolean;
}

export interface IEditorState {
  activeFilePath: string | null;
  openFiles: OpenFileContext[];
  syncStatus: SyncStatus;
}

/**
 * ==========================================
 * 4. PLUGINS / CONTRIBUTIONS (Extension Point)
 * ==========================================
 * A plugin contributes UI surfaces (menus, activity-bar panels) at boot. The
 * ContributionRegistry class implements IContributionRegistry; the interface is
 * declared here so this .d.ts stays free of implementation imports.
 */
export interface IContributionRegistry {
  registerMenu(menu: TopMenuCategory): void;
  registerActivityItem(item: ActivityBarItem): void;
}

export interface IEditorPlugin {
  name: string;
  contribute(registry: IContributionRegistry): void;
}

/**
 * The descriptor a host (e.g. env-manager) hands to the editor to boot a
 * workspace. sandboxId is the only hard requirement; the rest are optional
 * seams the boot flow fills in over time.
 */
export interface WorkspaceSession {
  sandboxId: string;
  workspaceName?: string;
  /** From env-manager. Typed seam — not yet consumed by the editor. */
  envConfig?: EnvironmentConfig;
  /** Resume-from-snapshot seam — typed, not yet consumed. */
  snapshot?: WorkspaceSnapshot;
  /** Extra plugins layered on top of the built-in core contributions. */
  plugins?: IEditorPlugin[];
}

/**
 * ==========================================
 * 5. SNAPSHOT TRAITS (State Restoration)
 * ==========================================
 */
export interface ISerializable<T> {
  getState(): T;
  restoreState(state: T): void;
}

/**
 * ==========================================
 * 6. SNAPSHOT PAYLOADS
 * ==========================================
 */
export type EditorViewState = Record<string, any>;

export interface FileSnapshotState {
  path: string;
  content: string;             
  viewState?: EditorViewState; 
}

export interface WorkspaceSnapshot {
  id: string;                  
  createdAt: number;           
  expiresAt?: number;          
  ownerId: string;             
  activeFilePath: string | null;
  openFiles: FileSnapshotState[];
  layoutState?: Record<string, any>; 
}