// frontend/src/editor/core/VirtualFileSystem.ts
import { VFSNode, VFSBulkSyncPayload } from './types/vfs';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict';

export class VirtualFileSystem {
  private fileMap: Map<string, VFSNode> = new Map();
  private syncQueue: Set<string> = new Set();
  private syncIntervalId: number | null = null;
  private readonly SYNC_INTERVAL_MS = 2000;

  constructor(
    private sandboxId: string,
    private onSyncStatusChange: (status: SyncStatus) => void // Callback instead of EventBus!
  ) {
    this.startBackgroundSync();
  }

  // --- API FOR THE CONTROLLER ---

  public async readFile(path: string): Promise<string> {
    const node = this.fileMap.get(path);
    if (node && node.content !== null) return node.content;

    // Simulate Network Fetch
    const content = await this.mockNetworkFetch(path);
    
    this.fileMap.set(path, {
      path,
      name: path.split('/').pop() || '',
      type: 'file',
      content,
      isDirty: false,
      lastModified: Date.now(),
      version: 1
    });

    return content;
  }

  public updateFile(path: string, newContent: string) {
    const node = this.fileMap.get(path);
    if (!node) return;

    node.content = newContent;
    node.isDirty = true;
    node.lastModified = Date.now();
    
    this.fileMap.set(path, node);
    this.syncQueue.add(path);
  }

  public async forceSync() {
    await this.flushSyncQueue();
  }

  // --- INTERNAL SYNC ENGINE ---

  private startBackgroundSync() {
    this.syncIntervalId = window.setInterval(() => {
      this.flushSyncQueue();
    }, this.SYNC_INTERVAL_MS);
  }

  private async flushSyncQueue() {
    if (this.syncQueue.size === 0) return;

    this.onSyncStatusChange('syncing');

    const payload: VFSBulkSyncPayload = {
      sandboxId: this.sandboxId,
      timestamp: Date.now(),
      updates: []
    };

    const pathsToSync = Array.from(this.syncQueue);
    for (const path of pathsToSync) {
      const node = this.fileMap.get(path);
      if (node && node.content !== null) {
        payload.updates.push({ path: node.path, content: node.content, version: node.version });
      }
    }

    try {
      // TODO: Actual fetch(`/api/sandboxes/${this.sandboxId}/fs/sync`, ...)
      await new Promise(resolve => setTimeout(resolve, 600)); 

      pathsToSync.forEach(path => {
        const node = this.fileMap.get(path);
        if (node) {
          node.isDirty = false;
          node.version += 1;
        }
        this.syncQueue.delete(path);
      });

      this.onSyncStatusChange('synced');
    } catch (error) {
      console.error("[VFS] Sync failed:", error);
      this.onSyncStatusChange('conflict');
    }
  }

  public destroy() {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
  }

  private mockNetworkFetch(path: string): Promise<string> {
    return new Promise(resolve => {
      setTimeout(() => {
        if (path.endsWith('.py')) resolve('import os\n\nprint("Hello from VFS!")');
        else if (path.endsWith('.env')) resolve('DISCORD_TOKEN=super_secret');
        else resolve('// Empty file');
      }, 300);
    });
  }
}