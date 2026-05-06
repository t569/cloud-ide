// frontend/src/editor/core/VFSController.ts
import { EditorEventBus } from './EditorEventBus';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import React from 'react';

export class VFSController {
  private vfs: VirtualFileSystem;
  // An array to hold all our event un-subscribers to prevent memory leaks
  private unsubs: Array<() => void> = [];

  constructor(
    private eventBus: EditorEventBus, 
    private dispatch: React.Dispatch<any>,
    private sandboxId: string
  ) {
    // 1. Instantiate the VFS Engine
    this.vfs = new VirtualFileSystem(sandboxId, (status) => {
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status } });
    });

    // 2. Start listening to UI events
    this.initListeners();
  }

  public async initWorkspace() {
    const initialTree = await this.vfs.hydrateWorkspace();
    this.eventBus.emit('VFS_TREE_UPDATED', { tree: initialTree });
  }

  private initListeners() {
    // ==========================================
    // CORE FILE I/O ROUTING
    // ==========================================

    this.unsubs.push(this.eventBus.on('FILE_OPEN_REQUESTED', async ({ path }) => {
      this.dispatch({ type: 'OPEN_FILE', payload: { path } });
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'syncing' } });

      try {
        const content = await this.vfs.readFile(path);
        this.eventBus.emit('FILE_LOADED', { path, content, language: this.guessLanguage(path) });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      } catch (error) {
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'conflict' } });
      }
    }));

    this.unsubs.push(this.eventBus.on('CONTENT_CHANGED', ({ path, newContent }) => {
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: true } });
      this.vfs.updateFile(path, newContent); 
    }));

    this.unsubs.push(this.eventBus.on('SAVE_REQUESTED', async ({ path }) => {
      await this.vfs.forceSync();
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: false } });
    }));

    // ==========================================
    // THE MISSING CRUD ROUTING (Create, Delete, Rename)
    // ==========================================

    this.unsubs.push(this.eventBus.on('FILE_CREATED', ({ path, type }) => {
      try {
        this.vfs.createFileOrDir(path, type);
        // Instantly generate the new tree and tell the UI to re-render
        this.eventBus.emit('VFS_TREE_UPDATED', { tree: this.vfs.getNestedTree() });
      } catch (e) {
        console.error("[Controller] Failed to create file:", e);
      }
    }));

    this.unsubs.push(this.eventBus.on('FILE_DELETED', ({ path }) => {
      this.vfs.deleteNode(path);
      // Instantly remove from the UI
      this.eventBus.emit('VFS_TREE_UPDATED', { tree: this.vfs.getNestedTree() });
      
      // Also, if the file was open in a tab, close it automatically!
      this.dispatch({ type: 'CLOSE_FILE', payload: { path } });
    }));

    this.unsubs.push(this.eventBus.on('FILE_RENAMED', ({ oldPath, newPath }) => {
      this.vfs.renameNode(oldPath, newPath);
      this.eventBus.emit('VFS_TREE_UPDATED', { tree: this.vfs.getNestedTree() });
    }));

    // ==========================================
    // UI TAB ROUTING
    // ==========================================

    this.unsubs.push(this.eventBus.on('TAB_ACTIVATED', ({ path }) => {
      this.dispatch({ type: 'SET_ACTIVE_FILE', payload: { path } });
    }));

    this.unsubs.push(this.eventBus.on('TAB_CLOSED', ({ path }) => {
      this.dispatch({ type: 'CLOSE_FILE', payload: { path } });
    }));
  }

  private guessLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return 'javascript';
      case 'ts': case 'tsx': return 'typescript';
      case 'py': return 'python';
      default: return 'plaintext';
    }
  }

  // ==========================================
  // CLEANUP (Prevents the Ghost Duplicate Logs)
  // ==========================================
  public destroy() {
    this.vfs.destroy();
    // Fire all the unsubscribe functions to detach from the EventBus
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
  }
}