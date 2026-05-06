// frontend/src/editor/core/VirtualFileSystem.ts
import { VFSNode, FileNode, VFSBulkSyncPayload, SyncStatus } from './types/vfs';

export class VirtualFileSystem {
  private fileMap: Map<string, VFSNode> = new Map();
  private syncQueue: Set<string> = new Set();
  private syncIntervalId: number | null = null;
  private readonly SYNC_INTERVAL_MS = 2000;

  constructor(
    private sandboxId: string,
    private onSyncStatusChange: (status: SyncStatus) => void
  ) {
    this.startBackgroundSync();
  }

  // ==========================================
  // 1. CORE CRUD OPERATIONS
  // ==========================================

  public async readFile(path: string): Promise<string> {
    const node = this.fileMap.get(path);
    if (node && node.content !== null) return node.content;

    // Simulate Network Fetch
    const content = await this.mockNetworkFetch(path);
    
    this.fileMap.set(path, {
      path, name: path.split('/').pop() || '', type: 'file', content,
      isDirty: false, markedForDeletion: false, lastModified: Date.now(), version: 1
    });

    return content;
  }

  public updateFile(path: string, newContent: string) {
    const node = this.fileMap.get(path);
    if (!node || node.markedForDeletion) return;

    node.content = newContent;
    node.isDirty = true;
    node.lastModified = Date.now();
    
    this.fileMap.set(path, node);
    this.syncQueue.add(path);
  }

  public createFileOrDir(path: string, type: 'file' | 'directory') {
    if (this.fileMap.has(path)) throw new Error("Path already exists");

    this.fileMap.set(path, {
      path, name: path.split('/').pop() || '', type,
      content: type === 'file' ? '' : null,
      isDirty: true, markedForDeletion: false, lastModified: Date.now(), version: 1
    });
    
    this.syncQueue.add(path);
  }

  public deleteNode(targetPath: string) {
    // 1. Find all files/folders that match this path (handles recursive directory deletion)
    for (const [path, node] of this.fileMap.entries()) {
      if (path === targetPath || path.startsWith(targetPath + '/')) {
        node.markedForDeletion = true;
        node.isDirty = true;
        this.syncQueue.add(path);
      }
    }
  }

  public renameNode(oldPath: string, newPath: string) {
    // A robust rename is essentially a copy + delete for the sync engine
    const oldNode = this.fileMap.get(oldPath);
    if (!oldNode) return;

    this.createFileOrDir(newPath, oldNode.type);
    if (oldNode.type === 'file') {
      this.updateFile(newPath, oldNode.content || '');
    }
    this.deleteNode(oldPath);
  }

  // ==========================================
  // 2. THE TREE GENERATOR (For React UI)
  // ==========================================
  
  /**
   * Converts the O(1) Flat Map into a nested JSON tree for the File Explorer.
   * Runs in O(N log N) time due to sorting, which is extremely fast for standard project sizes.
   */
  public getNestedTree(): FileNode[] {
    const root: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    // Sort paths to guarantee parent directories are processed before their children
    const sortedPaths = Array.from(this.fileMap.keys()).sort();

    for (const path of sortedPaths) {
      const vfsNode = this.fileMap.get(path)!;
      
      // Do not render files that the user just deleted (even if not synced yet)
      if (vfsNode.markedForDeletion) continue;

      const fileNode: FileNode = {
        name: vfsNode.name,
        path: vfsNode.path,
        type: vfsNode.type,
        ...(vfsNode.type === 'directory' ? { children: [] } : {})
      };
      
      nodeMap.set(path, fileNode);

      // Find parent path (e.g., '/src/components/App.tsx' -> '/src/components')
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      
      if (parentPath === '') {
        root.push(fileNode); // It's at the root directory
      } else {
        const parent = nodeMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(fileNode);
        } else {
          root.push(fileNode); // Fallback if parent directory is missing
        }
      }
    }
    
    return root;
  }

  // ==========================================
  // 3. BACKGROUND SYNC ENGINE
  // ==========================================

  public async forceSync() { await this.flushSyncQueue(); }

  private startBackgroundSync() {
    this.syncIntervalId = window.setInterval(() => { this.flushSyncQueue(); }, this.SYNC_INTERVAL_MS);
  }

  private async flushSyncQueue() {
    if (this.syncQueue.size === 0) return;

    this.onSyncStatusChange('syncing');

    const payload: VFSBulkSyncPayload = {
      sandboxId: this.sandboxId, timestamp: Date.now(), updates: [], deletes: []
    };

    const pathsToSync = Array.from(this.syncQueue);
    
    // Build the payload
    for (const path of pathsToSync) {
      const node = this.fileMap.get(path);
      if (!node) continue;

      if (node.markedForDeletion) {
        payload.deletes.push({ path });
      } else if (node.content !== null) {
        payload.updates.push({ path, content: node.content, version: node.version });
      }
    }

    try {
      // TODO: Actual API Call
      await new Promise(resolve => setTimeout(resolve, 600)); 

      // On Success: Cleanup the Map
      pathsToSync.forEach(path => {
        const node = this.fileMap.get(path);
        if (!node) return;

        if (node.markedForDeletion) {
          this.fileMap.delete(path); // Backend confirmed deletion, remove from memory
        } else {
          node.isDirty = false;
          node.version += 1;
        }
        this.syncQueue.delete(path);
      });

      this.onSyncStatusChange('synced');
    } catch (error) {
      console.error("[VFS] Sync failed:", error);
      // Basic Conflict Resolution: Leave them in the queue, mark UI red. 
      // Next tick will try again.
      this.onSyncStatusChange('conflict');
    }
  }

  public destroy() {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
  }

  // Temporary mock data
  private mockNetworkFetch(path: string): Promise<string> {
    return new Promise(resolve => {
      setTimeout(() => {
        if (path.endsWith('.py')) resolve('import os\n\nprint("Hello from VFS!")');
        else if (path.endsWith('.env')) resolve('DISCORD_TOKEN=super_secret');
        else resolve('');
      }, 300);
    });
  }
}