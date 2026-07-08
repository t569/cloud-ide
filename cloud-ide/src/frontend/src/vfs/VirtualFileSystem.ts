// frontend/src/editor/core/VirtualFileSystem.ts
import {
  VFSNode,
  FileNode,
  SyncStatus
} from './types/vfs';
import { apiClient } from '../lib/apiClient';

/** The container-visible workspace root; the whole tree hangs under here. */
const WORKSPACE_ROOT = '/workspace';

/** One entry from GET /api/fs/:id/ls (backend VfsNode: name + container path + type). */
interface VfsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

/**
 * ============================================================================
 * VIRTUAL FILE SYSTEM (VFS) ENGINE
 * ============================================================================
 * * ARCHITECTURE OVERVIEW:
 * This class is the definitive Single Source of Truth for file data in the browser.
 * It is fully decoupled from the React UI and the EventBus. It acts purely as a 
 * high-performance data engine and sync coordinator.
 * * THE DATA FLOW (Frontend -> Backend):
 * 1. UI Interaction: User types in Monaco or clicks "New File" in the Explorer.
 * 2. Controller Routing: The VFSController hears the UI event via the EventBus 
 * and calls the appropriate CRUD method here (e.g., `vfs.updateFile()`).
 * 3. Optimistic Update: The VFS instantly updates its O(1) `fileMap` in memory 
 * and adds the file path to the `syncQueue`.
 * 4. Background Hashing (Lazy Merkle): Every 2 seconds, the sync loop wakes up. 
 * It generates SHA-256 hashes *only* for the files that changed in the queue, 
 * then calculates a new `Root SHA` for the entire workspace.
 * 5. Network Push: The VFS sends a Git-style payload to the backend API containing 
 * only the changed blobs, the old Root SHA, and the new Root SHA.
 * 6. Backend Resolution: The backend verifies the SHAs against its own internal 
 * Git worktree. If successful, it writes the files and returns 200 OK.
 * 7. State Confirmation: The VFS removes the files from the queue and updates 
 * the UI Traffic Light to 'synced'.
 */
export class VirtualFileSystem {
  /** * The O(1) Flat Map memory store. 
   * Stores files flatly (e.g., map.get('/src/app.ts')) for instant read/write latency. 
   */
  private fileMap: Map<string, VFSNode> = new Map();
  
  /** * The Debounce Queue. 
   * Tracks paths that have been modified locally but not yet acknowledged by the backend. 
   */
  private syncQueue: Set<string> = new Set();
  
  /** Interval ID for the background sync loop so it can be cleanly destroyed. */
  private syncIntervalId: number | null = null;
  private readonly SYNC_INTERVAL_MS = 2000;

  /**
   * Initializes the VFS and starts the background synchronization daemon.
   * @param sandboxId - The unique ID of the backend sandbox/container this VFS talks to.
   * @param onSyncStatusChange - Callback used to update the React UI traffic light.
   */
  constructor(
    private sandboxId: string,
    private onSyncStatusChange: (status: SyncStatus) => void
  ) {
    this.startBackgroundSync();
  }

  // ==========================================
  // 1. WORKSPACE HYDRATION
  // ==========================================

  /**
   * Called ONCE when the IDE first loads by the VFSController.
   * Fetches the entire project structure from the backend and populates the memory map.
   * @returns The nested React UI Tree so the File Explorer can render immediately.
   */
  public async hydrateWorkspace(): Promise<FileNode[]> {
    this.onSyncStatusChange('syncing');

    try {
      // The backend host-mount is the source of truth; take a fresh snapshot.
      this.fileMap.clear();
      await this.loadDirectory(WORKSPACE_ROOT);
      this.onSyncStatusChange('synced');
      return this.getNestedTree();
    } catch (error) {
      console.error('[VFS] Failed to hydrate workspace:', error);
      this.onSyncStatusChange('conflict');
      return [];
    }
  }

  /**
   * Recursively lists a directory via GET /api/fs/:id/ls and populates the flat
   * map. File contents are left null and lazy-loaded on first read() — boot only
   * needs the tree shape, not every blob.
   * ponytail: naive per-directory walk (N requests, children fetched in
   * parallel). Add a recursive /tree endpoint only if this hurts on big repos.
   */
  private async loadDirectory(dirPath: string): Promise<void> {
    const entries = await apiClient.get<VfsEntry[]>(
      `/fs/${encodeURIComponent(this.sandboxId)}/ls?path=${encodeURIComponent(dirPath)}`,
    );
    await Promise.all(
      entries.map(async (entry) => {
        this.fileMap.set(entry.path, {
          path: entry.path,
          name: entry.name,
          type: entry.type,
          content: null,
          sha: null,
          isDirty: false,
          markedForDeletion: false,
          lastModified: Date.now(),
          version: 1,
        });
        if (entry.type === 'directory') await this.loadDirectory(entry.path);
      }),
    );
  }

  // ==========================================
  // 2. CORE CRUD OPERATIONS (Optimistic UI)
  // ==========================================

  
  /**
   * Retrieves file content instantly from memory.
   */
  public async readFile(path: string): Promise<string> {
    const node = this.fileMap.get(path);
    if (!node) throw new Error(`File not found in VFS: ${path}`);
    if (node.type !== 'file') return '';

    // Lazy-load: hydrate only fetched the tree, so pull the blob on first open
    // via GET /api/fs/:id/read and cache it for instant subsequent reads.
    if (node.content === null) {
      const { content } = await apiClient.get<{ content: string }>(
        `/fs/${encodeURIComponent(this.sandboxId)}/read?path=${encodeURIComponent(path)}`,
      );
      node.content = content;
      this.fileMap.set(path, node);
    }
    return node.content;
  }

  /**
   * Updates file content in memory instantly (Optimistic Update) and queues it for the backend.
   * Called by the controller every time the user types a keystroke in Monaco.
   */
  public updateFile(path: string, newContent: string) {
    const node = this.fileMap.get(path);
    // Do not allow updates to files the user just deleted but haven't synced yet
    if (!node || node.markedForDeletion) return;

    node.content = newContent;
    node.isDirty = true;
    node.lastModified = Date.now();
    
    this.fileMap.set(path, node);
    this.syncQueue.add(path); // Mark for next background sync tick
  }

  /**
   * Helper method to recursively ensure parent directories exist in the VFS before
   * creating nested files (e.g. creating '/jack' before '/jack/robinson.asm').
   */
  private ensureDirectoriesExist(filePath: string): void {
    const parts = filePath.split('/').filter(Boolean);
    parts.pop(); // Remove the actual file name at the end

    let currentPath = '';
    
    for (const part of parts) {
      currentPath += `/${part}`;
      
      // If this directory doesn't exist in our memory map, create it
      if (!this.fileMap.has(currentPath)) {
        console.log(`[VFS] Auto-creating missing directory: ${currentPath}`);
        
        const newDir: VFSNode = {
          path: currentPath,
          name: part,
          type: 'directory',
          content: null,
          sha: null,
          isDirty: true,
          markedForDeletion: false,
          lastModified: Date.now(),
          version: 1
        };
        
        this.fileMap.set(currentPath, newDir);
        this.syncQueue.add(currentPath);
      }
    }
  }

  /**
   * Creates a new file or directory locally and queues the creation for the backend.
   */
  public createFileOrDir(path: string, type: 'file' | 'directory') {
    if (this.fileMap.has(path)) throw new Error("Path already exists");

    // Force the creation of intermediate folders first
    this.ensureDirectoriesExist(path);

    this.fileMap.set(path, {
      path, 
      name: path.split('/').pop() || '', 
      type,
      content: type === 'file' ? '' : null,
      sha: null,
      isDirty: true, 
      markedForDeletion: false, 
      lastModified: Date.now(), 
      version: 1
    });
    
    this.syncQueue.add(path);
  }

  /**
   * Marks a file or directory (and recursively all its children) for deletion.
   * The UI hides it instantly, but it stays in memory until the backend confirms the delete.
   */
  public deleteNode(targetPath: string) {
    // Recursive deletion: Iterate through the flat map to find the node and all children
    for (const [path, node] of this.fileMap.entries()) {
      if (path === targetPath || path.startsWith(targetPath + '/')) {
        node.markedForDeletion = true;
        node.isDirty = true;
        this.syncQueue.add(path);
      }
    }
  }

  /**
   * Renames a node. Handled gracefully as a "Create new -> Copy content -> Mark old for deletion"
   * to ensure no data is lost during transit.
   */
  public renameNode(oldPath: string, newPath: string) {
    for (const [path, node] of this.fileMap.entries()) {
      // Find the specific file, or any files nested inside the directory being renamed
      if (path === oldPath || path.startsWith(oldPath + '/')) {
        const adjustedNewPath = path.replace(oldPath, newPath);
        
        // 1. Create the new destination
        this.createFileOrDir(adjustedNewPath, node.type);
        
        // 2. Copy the content over
        if (node.type === 'file' && node.content !== null) {
          this.updateFile(adjustedNewPath, node.content);
        }
        
        // 3. Mark the original for deletion
        node.markedForDeletion = true;
        node.isDirty = true;
        this.syncQueue.add(path);
      }
    }
  }

  // ==========================================
  // 3. THE TREE GENERATOR (For React UI)
  // ==========================================
  
  /**
   * Transforms the high-speed O(1) Flat Map into a recursive JSON tree.
   * This is required because React UI components (like the Sidebar Explorer) need nested arrays to render folders.
   * Filters out any files currently `markedForDeletion` so the UI appears snappy.
   */
  public getNestedTree(): FileNode[] {
    const root: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    // Sort paths alphabetically. This guarantees that a parent directory (e.g., '/src')
    // is processed and added to the map BEFORE its children (e.g., '/src/main.ts').
    const sortedPaths = Array.from(this.fileMap.keys()).sort();

    for (const path of sortedPaths) {
      const vfsNode = this.fileMap.get(path)!;
      
      // Hide deleted files from the UI immediately
      if (vfsNode.markedForDeletion) continue;

      const fileNode: FileNode = {
        name: vfsNode.name,
        path: vfsNode.path,
        type: vfsNode.type,
        ...(vfsNode.type === 'directory' ? { children: [] } : {})
      };
      
      nodeMap.set(path, fileNode);

      // String manipulation to find parent (e.g., '/src/components/App.tsx' -> '/src/components')
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      
      if (parentPath === '') {
        root.push(fileNode); // Belongs to the root directory
      } else {
        const parent = nodeMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(fileNode); // Attach to parent folder
        } else {
          root.push(fileNode); // Fallback safeguard if parent is somehow missing
        }
      }
    }
    
    return root;
  }

  // ==========================================
  // 4. THE SYNC LOOP
  // ==========================================

  /** * Bypasses the 2-second timer to sync immediately. Called when the user hits Ctrl+S.
   */
  public async forceSync() { 
    await this.flushSyncQueue(); 
  }

  /**
   * Starts the background daemon that periodically pushes changes to the backend without blocking the main thread.
   */
  private startBackgroundSync() {
    this.syncIntervalId = window.setInterval(() => { 
      this.flushSyncQueue(); 
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Pushes queued changes to the backend using the real per-file FS API
   * (POST /write, DELETE /delete). Only files (content !== null) are written —
   * empty directories aren't persisted, git-style: a file write auto-creates its
   * parent dirs on the backend.
   * ponytail: no merkle/conflict protocol — the FS API is last-write-wins. Add
   * optimistic concurrency (base/next SHA) if/when a /git-sync endpoint exists.
   */
  private async flushSyncQueue() {
    if (this.syncQueue.size === 0) return;
    this.onSyncStatusChange('syncing');

    const writes: { path: string; content: string }[] = [];
    const deletes: string[] = [];

    for (const path of Array.from(this.syncQueue)) {
      const node = this.fileMap.get(path);
      if (!node) continue;
      if (node.markedForDeletion) deletes.push(path);
      else if (node.content !== null) writes.push({ path, content: node.content });
    }

    const id = encodeURIComponent(this.sandboxId);
    try {
      await Promise.all([
        ...writes.map((w) => apiClient.post(`/fs/${id}/write`, { path: w.path, content: w.content })),
        ...deletes.map((p) => apiClient.delete(`/fs/${id}/delete?path=${encodeURIComponent(p)}`)),
      ]);

      // Success: clear the queue, drop deleted nodes, un-dirty the written ones.
      this.syncQueue.clear();
      deletes.forEach((path) => this.fileMap.delete(path));
      writes.forEach((w) => {
        const node = this.fileMap.get(w.path);
        if (node) node.isDirty = false;
      });
      this.onSyncStatusChange('synced');
    } catch (error) {
      // Queue stays intact; the next tick retries (write/delete are idempotent).
      console.error('[VFS] Sync failed (network or backend error):', error);
      this.onSyncStatusChange('conflict');
    }
  }

  /**
   * Safely spins down the VFS engine and cleans up intervals to prevent memory leaks when the IDE unmounts.
   */
  public destroy() {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
  }
}