// frontend/src/editor/core/VFSController.ts
import { EditorEventBus } from './EditorEventBus';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import React from 'react';

export class VFSController {
  private vfs: VirtualFileSystem;

  constructor(
    private eventBus: EditorEventBus, 
    private dispatch: React.Dispatch<any>,
    private sandboxId: string
  ) {
    // 1. Instantiate the VFS Engine, passing a callback to update React's status
    this.vfs = new VirtualFileSystem(sandboxId, (status) => {
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status } });
    });

    // 2. Start listening to UI events
    this.initListeners();
  }

  private initListeners() {
    // UI requests a file to be opened
    this.eventBus.on('FILE_OPEN_REQUESTED', async ({ path }) => {
      this.dispatch({ type: 'OPEN_FILE', payload: { path } });
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'syncing' } });

      try {
        // ASKING THE VFS FOR THE DATA
        const content = await this.vfs.readFile(path);
        
        // Telling Monaco to render it
        this.eventBus.emit('FILE_LOADED', { path, content, language: this.guessLanguage(path) });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      } catch (error) {
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'conflict' } });
      }
    });

    // User types in Monaco
    this.eventBus.on('CONTENT_CHANGED', ({ path, newContent }) => {
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: true } });
      
      // TELLING THE VFS TO UPDATE ITS MAP & QUEUE IT FOR SYNC
      this.vfs.updateFile(path, newContent); 
    });

    // User hits Ctrl+S or clicks "Save" in the menu
    this.eventBus.on('SAVE_REQUESTED', async ({ path }) => {
      // TELLING THE VFS TO SKIP THE TIMER AND SYNC IMMEDIATELY
      await this.vfs.forceSync();
      
      // Only mark clean in the UI if the VFS successfully synced it
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: false } });
    });

    // --- Standard UI State Routing ---
    this.eventBus.on('TAB_ACTIVATED', ({ path }) => {
      this.dispatch({ type: 'SET_ACTIVE_FILE', payload: { path } });
    });

    this.eventBus.on('TAB_CLOSED', ({ path }) => {
      this.dispatch({ type: 'CLOSE_FILE', payload: { path } });
    });
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

  // Cleanup method for when the IDE is closed
  public destroy() {
    this.vfs.destroy();
  }
}