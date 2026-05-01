// frontend/src/editor/types/editor.d.ts

/**
 * ==========================================
 * GLOBAL IDE SETTINGS
 * ==========================================
 */
export interface IDEGlobalSettings {
  fontFamily: string;      // e.g., "'JetBrains Mono', monospace"
  fontSize: number;        // Global UI font size (Monaco and Terminal might have overrides)
  theme: 'dark' | 'light';
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

export interface IVirtualFileSystem {
  /** Fetches the directory structure. Can be recursive or shallow depending on implementation. */
  readDirectory(path: string): Promise<FileNode[]>;
  /** Fetches the actual text content of a file to feed to Monaco. */
  readFile(path: string): Promise<string>;
  /** Pushes new content to the storage layer. */
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteNode(path: string): Promise<void>;
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

  /** Fired when a user closes a tab in the Top Display. */
  'TAB_CLOSED': { path: string };

  /** Fired when a user switches between already-open tabs. */
  'TAB_ACTIVATED': { path: string };

  /** Fired by Monaco on keystroke. Triggers the 'dirty' dot on the UI tab. */
  'CONTENT_CHANGED': { path: string; newContent: string; isDirty: boolean };

  /** Fired by Ctrl+S or the TopNav File -> Save button. */
  'SAVE_REQUESTED': { path: string };

  /** Fired by the VFS to update the Traffic Light UI (Sidebar). */
  'SYNC_STATUS_CHANGED': { status: SyncStatus };

  /** Fired when a file/folder is created or deleted, prompting the Explorer to re-render. */
  'TREE_UPDATED': { rootNode: FileNode };

  // --- Snapshot Events ---

  /** 
   * Fired when a user clicks the "Share Snapshot" button. 
   * The top-level component intercepts this, calls getState() on its children, 
   * and compiles the WorkspaceSnapshot payload.
   */
  'SNAPSHOT_CREATE_REQUESTED': { ttlSeconds?: number }; // Optional Time-to-Live

  /** 
   * Fired when the payload is successfully built and saved to the backend. 
   * Useful for showing a toast notification with the shareable link.
   */
  'SNAPSHOT_CREATED': { shareableUrl: string; snapshot: WorkspaceSnapshot };

  /** 
   * Fired when the IDE is booted up via a shared snapshot URL.
   * Instructs the components to pause normal boot and instead run restoreState().
   */
  'SNAPSHOT_LOAD_REQUESTED': { snapshotId: string };
}

export type EditorEventType = keyof EditorEventPayloads;

/**
 * ==========================================
 * 3. STATE & DATA MODELS
 * ==========================================
 * The data models that your context provider or main workspace component will track.
 */

export type SyncStatus = 'synced' | 'syncing' | 'conflict';

export interface OpenFileContext {
  path: string;
  isDirty: boolean;
  // We don't store the raw text content here to save RAM. 
  // Monaco manages the active text buffer internally via its ITextModel.
}

export interface IEditorState {
  activeFilePath: string | null;
  openFiles: OpenFileContext[];
  syncStatus: SyncStatus;
}

/**
 * ==========================================
 * 4. PLUGINS / MIDDLEWARE (Future Proofing)
 * ==========================================
 * Contract for adding features like auto-formatters, Claude Code, or syntax linting.
 */
export interface IEditorPlugin {
  name: string;
  /** Allows the plugin to hook into the Event Bus when the workspace boots. */
  onInit(eventBus: any /* Type this to your actual EventBus class */): void;
}

/**
 * ==========================================
 * 5. SNAPSHOT TRAITS (State Restoration)
 * ==========================================
 * Every major UI component must implement this contract. 
 * This allows the root IDE component to extract and inject state blindly.
 */
export interface ISerializable<T> {
  /** Extracts the current context of the component */
  getState(): T;
  /** Injects a previous context back into the component */
  restoreState(state: T): void;
}


/**
 * ==========================================
 * 6. SNAPSHOT PAYLOADS
 * ==========================================
 */

/** 
 * Represents Monaco's internal view state (cursor position, scroll, selections). 
 * Kept generic as a Record so we don't have to import heavy Monaco types here.
 */
export type EditorViewState = Record<string, any>;

export interface FileSnapshotState {
  path: string;
  content: string;             // The raw text buffer at the time of the snapshot
  viewState?: EditorViewState; // Where the cursor and scrollbar were
}

export interface WorkspaceSnapshot {
  id: string;                  // The UUID used for the shareable link
  
  // Metadata for your "timed limits" feature
  createdAt: number;           // Unix timestamp
  expiresAt?: number;          // Unix timestamp for auto-destructing links
  ownerId: string;             // The user who generated the snapshot
  
  // Visual Context
  activeFilePath: string | null;
  openFiles: FileSnapshotState[];
  
  // Optional layout data (e.g., how wide the sidebar was, terminal height)
  layoutState?: Record<string, any>; 
}