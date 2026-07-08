// frontend/src/vfs/types/vfs.d.ts
//
// Core data types for the Virtual File System. These are the ONLY VFS types in
// use; the earlier GitSyncPayload / IVirtualFileSystem / WorkspaceHydrationPayload
// / VFSBulkSyncPayload scaffolding described a client-side Merkle sync protocol
// that was never built (git IS the Merkle/WAL — see root ARCHITECTURE.md) and
// has been removed to stop it misleading readers.

export type SyncStatus = 'synced' | 'syncing' | 'conflict';

/** The core file representation held in the VFS flat map. */
export interface VFSNode {
  path: string;          // Primary Key (e.g., '/src/bot.py')
  name: string;          // Display name (e.g., 'bot.py')
  type: 'file' | 'directory';
  content: string | null; // Null if it's a directory or if content isn't fetched yet
  sha: string | null;       // Reserved for future git-backed conflict resolution
  isDirty: boolean;      // True if the user edited it but it hasn't successfully synced
  markedForDeletion: boolean; // True if the user deleted it but it hasn't successfully synced
  lastModified: number;  // Timestamp of last local edit
  version: number;       // Incremented on every save
}

// One tree-shape change pushed by the backend watcher over SSE (Gap A). The
// client applies these surgically so unsaved edits survive a disk change.
export interface FsChange {
  kind: 'add' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string; // e.g. /workspace/src/app.ts
}

/** The nested tree the File Explorer renders (derived from the flat map). */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[]; // Only populated if type === 'directory'
}
