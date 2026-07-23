// frontend/src/vfs/FileStore.ts
//
// Where the VFS's bytes actually live. `VirtualFileSystem` owns the in-memory map, the
// dirty tracking and the sync queue; this port owns nothing but the five operations that
// touch storage, so the engine above it is identical whichever tier is running:
//
//   HttpFileStore  → the backend worktree over /api/fs   (today's server tiers)
//   OpfsFileStore  → the browser's own disk, no server   (the free tier)
//
// Paths are ABSOLUTE and workspace-rooted (`/workspace/src/main.ts`) — the same strings the
// VFS map is keyed by, so a store never has to know about the VFS's addressing and the VFS
// never has to know where a store puts things.

export interface StoreEntry {
  name: string;
  /** Absolute path, as the VFS keys its map. */
  path: string;
  type: 'file' | 'directory';
}

export interface FileStore {
  /** One directory level. Not recursive — the VFS decides what to walk. */
  list(dirPath: string): Promise<StoreEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;

  /**
   * Read something OUTSIDE the workspace, read-only — a stdlib source, site-packages, a
   * path the terminal printed.
   *
   * Optional on purpose: it only means anything where a machine exists beyond the
   * workspace. The browser store has no such world and deliberately omits it, so "there is
   * nothing out there" is expressed by the type rather than by a stub that throws.
   */
  readExternal?(path: string): Promise<string>;
}
