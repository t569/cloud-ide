// frontend/src/editor/core/VirtualFileSystem.ts
import { 
  VFSNode, 
  FileNode, 
  GitSyncPayload, 
  WorkspaceHydrationPayload, 
  SyncStatus 
} from './types/vfs';

export class VirtualFileSystem {
  private fileMap: Map<string, VFSNode> = new Map();
  private syncQueue: Set<string> = new Set();
  private syncIntervalId: number | null = null;
  private readonly SYNC_INTERVAL_MS = 2000;
  
  // The Merkle Root Hash tracking the frontend's current confirmed state
  private currentRootSha: string = '';

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
   * Called ONCE when the IDE loads to populate the memory map from the backend.
   */
  public async hydrateWorkspace(): Promise<FileNode[]> {
    this.onSyncStatusChange('syncing');

    try {
      // TODO: Replace with actual fetch to your backend API
      // const res = await fetch(`/api/sandboxes/${this.sandboxId}/workspace`);
      // const payload: WorkspaceHydrationPayload = await res.json();
      
      const mockPayload: WorkspaceHydrationPayload = {
        sandboxId: this.sandboxId,
        rootSha: 'initial_base_sha_from_git',
        files: [
          { path: '/src', type: 'directory', content: null, lastModified: Date.now(), version: 1 },
          { path: '/src/main.py', type: 'file', content: 'print("Booting system...")', lastModified: Date.now(), version: 1 },
          { path: '/README.md', type: 'file', content: '# Documentation', lastModified: Date.now(), version: 1 }
        ]
      };

      await new Promise(resolve => setTimeout(resolve, 800)); // Simulate latency

      // Inject into O(1) map
      mockPayload.files.forEach(file => {
        this.fileMap.set(file.path, {
          path: file.path,
          name: file.path.split('/').pop() || '',
          type: file.type,
          content: file.content,
          sha: null, // Will be calculated dynamically when edited
          isDirty: false,
          markedForDeletion: false,
          lastModified: file.lastModified,
          version: file.version
        });
      });

      this.currentRootSha = mockPayload.rootSha || '';
      this.onSyncStatusChange('synced');
      
      // Return the nested tree so the File Explorer can render immediately
      return this.getNestedTree();

    } catch (error) {
      console.error("[VFS] Failed to hydrate workspace:", error);
      this.onSyncStatusChange('conflict');
      return [];
    }
  }

  // ==========================================
  // 2. CORE CRUD OPERATIONS
  // ==========================================

  public async readFile(path: string): Promise<string> {
    const node = this.fileMap.get(path);
    if (!node) throw new Error(`File not found in VFS: ${path}`);
    
    // In the future, if you implement lazy-loading for huge files, 
    // you would fetch here if node.content === null
    return node.content || '';
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

  public deleteNode(targetPath: string) {
    // Recursive deletion: find node and all children
    for (const [path, node] of this.fileMap.entries()) {
      if (path === targetPath || path.startsWith(targetPath + '/')) {
        node.markedForDeletion = true;
        node.isDirty = true;
        this.syncQueue.add(path);
      }
    }
  }

  public renameNode(oldPath: string, newPath: string) {
    // Robust rename: acts as a copy + recursive delete
    for (const [path, node] of this.fileMap.entries()) {
      if (path === oldPath || path.startsWith(oldPath + '/')) {
        const adjustedNewPath = path.replace(oldPath, newPath);
        
        this.createFileOrDir(adjustedNewPath, node.type);
        if (node.type === 'file' && node.content !== null) {
          this.updateFile(adjustedNewPath, node.content);
        }
        
        // Mark old path for deletion
        node.markedForDeletion = true;
        node.isDirty = true;
        this.syncQueue.add(path);
      }
    }
  }

  // ==========================================
  // 3. THE TREE GENERATOR (For React UI)
  // ==========================================
  
  public getNestedTree(): FileNode[] {
    const root: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    // Sort paths alphabetically so parents process before children
    const sortedPaths = Array.from(this.fileMap.keys()).sort();

    for (const path of sortedPaths) {
      const vfsNode = this.fileMap.get(path)!;
      
      if (vfsNode.markedForDeletion) continue;

      const fileNode: FileNode = {
        name: vfsNode.name,
        path: vfsNode.path,
        type: vfsNode.type,
        ...(vfsNode.type === 'directory' ? { children: [] } : {})
      };
      
      nodeMap.set(path, fileNode);

      const parentPath = path.substring(0, path.lastIndexOf('/'));
      
      if (parentPath === '') {
        root.push(fileNode);
      } else {
        const parent = nodeMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(fileNode);
        } else {
          root.push(fileNode); // Fallback
        }
      }
    }
    
    return root;
  }

  // ==========================================
  // 4. LIGHTWEIGHT MERKLE / GIT ENGINE
  // ==========================================

  private async calculateSha(content: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async calculateRootSha(): Promise<string> {
    const sortedPaths = Array.from(this.fileMap.keys()).sort();
    let combinedHashes = '';
    
    for (const path of sortedPaths) {
      const node = this.fileMap.get(path);
      if (node && !node.markedForDeletion && node.sha) {
        combinedHashes += node.sha;
      }
    }
    return this.calculateSha(combinedHashes);
  }

  // ==========================================
  // 5. THE GIT-STYLE SYNC LOOP
  // ==========================================

  public async forceSync() { 
    await this.flushSyncQueue(); 
  }

  private startBackgroundSync() {
    this.syncIntervalId = window.setInterval(() => { 
      this.flushSyncQueue(); 
    }, this.SYNC_INTERVAL_MS);
  }

  private async flushSyncQueue() {
    if (this.syncQueue.size === 0) return;
    this.onSyncStatusChange('syncing');

    const expectedBaseSha = this.currentRootSha;

    // 1. "git add" -> Calculate new SHAs only for dirty files
    const blobsToPush: { path: string; sha: string; content: string }[] = [];
    const deletesToPush: string[] = [];

    for (const path of Array.from(this.syncQueue)) {
      const node = this.fileMap.get(path);
      if (!node) continue;

      if (node.markedForDeletion) {
        deletesToPush.push(path);
      } else if (node.content !== null) {
        node.sha = await this.calculateSha(node.content);
        blobsToPush.push({ path, sha: node.sha, content: node.content });
      }
    }

    // 2. "git commit" -> Calculate new Root SHA
    const newRootSha = await this.calculateRootSha();

    // 3. "git push" -> Build payload
    const payload: GitSyncPayload = {
      sandboxId: this.sandboxId,
      expectedBaseSha,
      newRootSha,
      blobs: blobsToPush,
      deletes: deletesToPush
    };

    try {
      // TODO: POST payload to your backend.
      // e.g., await fetch(`/api/v1/sandboxes/${this.sandboxId}/git-sync`, { method: 'POST', body: JSON.stringify(payload) })
      await new Promise(resolve => setTimeout(resolve, 600)); 

      // 4. Cleanup on success
      this.currentRootSha = newRootSha;
      this.syncQueue.clear();
      
      deletesToPush.forEach(path => this.fileMap.delete(path));

      this.onSyncStatusChange('synced');
    } catch (error) {
      console.error("[VFS] Push rejected (Conflict or Network Error):", error);
      this.onSyncStatusChange('conflict');
    }
  }

  public destroy() {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
  }
}