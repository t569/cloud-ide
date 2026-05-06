// frontend/src/editor/core/vfs.d.ts

/**
 * This file defines the core data structures and API contract for our Virtual File System (VFS).
 * The VFS is responsible for maintaining an in-memory representation of the file system, 
 * handling optimistic updates, and syncing with the backend.
 */
// The core file representation in memory

export type SyncStatus = 'synced' | 'syncing' | 'conflict';


export interface VFSNode {
  path: string;          // Primary Key (e.g., '/src/bot.py')
  name: string;          // Display name (e.g., 'bot.py')
  type: 'file' | 'directory';
  content: string | null; // Null if it's a directory or if content isn't fetched yet
  isDirty: boolean;      // True if the user edited it but it hasn't successfully synced
  markedForDeletion: boolean; // True if the user deleted it but it hasn't successfully synced
  lastModified: number;  // Timestamp of last local edit
  version: number;       // Incremented on every save to handle conflict resolution
}

// the UI filenode type for local syncing logic
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[]; // Only populated if type === 'directory'
}

export interface VFSBulkSyncPayload {
  sandboxId: string;
  timestamp: number;
  updates: { path: string; content: string; version: number }[];
  deletes: {path: string}[];  // tell the bakend which files were deleted 
}
// The API Contract for the VFS class
export interface IVirtualFileSystem {
  // Read Operations
  readFile(path: string): Promise<string>;
  readDirectory(path: string): Promise<VFSNode[]>;
  exists(path: string): boolean;

  // Write Operations (Optimistic)
  writeFile(path: string, content: string): void;
  createFile(path: string): void;
  createDirectory(path: string): void;
  delete(path: string): void;
  rename(oldPath: string, newPath: string): void;

  // Sync Operations
  syncToBackend(): Promise<void>;
  fetchRemoteTree(): Promise<void>;
}

// TODO: we will likely need additional types for representing file system events, 
// conflict resolution strategies, 
// and sync status updates as we build out the VFS further.
// we also need to define what our backend API contract looks like for syncing file changes,
// The skeleton for the JSON payload we will eventually send to your backend
export interface VFSBulkSyncPayload {
  sandboxId: string;
  timestamp: number;
  updates: {
    path: string;
    content: string;
    version: number;
  }[];
}