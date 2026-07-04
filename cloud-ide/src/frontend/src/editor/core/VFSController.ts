// frontend/src/editor/core/VFSController.ts
import { EditorEventBus } from './EditorEventBus';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import React from 'react';

/**
 * Sanitizes a workspace path before it reaches the VFS or the backend filesystem.
 * This is the front-end's single choke point for path safety: it rejects
 * traversal (`..`), null bytes, and non-rooted junk, and forces a clean
 * `/`-rooted path. The backend MUST re-validate — this is not a substitute.
 *
 * @returns a clean absolute path, or null if the input is unsafe/empty.
 */
export function safePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0')) return null;
  // Drop empty segments (collapses `//`) and current-dir `.` segments.
  const segments = rawPath.split('/').filter(seg => seg !== '' && seg !== '.');
  if (segments.length === 0) return null;
  if (segments.some(seg => seg === '..')) return null;
  return '/' + segments.join('/');
}

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

    this.unsubs.push(this.eventBus.on('FILE_OPEN_REQUESTED', async ({ path: rawPath }) => {
      const path = safePath(rawPath);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', rawPath); return; }

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

    this.unsubs.push(this.eventBus.on('CONTENT_CHANGED', ({ path: rawPath, newContent }) => {
      const path = safePath(rawPath);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', rawPath); return; }
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

    this.unsubs.push(this.eventBus.on('FILE_CREATED', ({ path: rawPath, type }) => {
      const path = safePath(rawPath);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', rawPath); return; }
      try {
        this.vfs.createFileOrDir(path, type);
        // Instantly generate the new tree and tell the UI to re-render
        this.eventBus.emit('VFS_TREE_UPDATED', { tree: this.vfs.getNestedTree() });
      } catch (e) {
        console.error("[Controller] Failed to create file:", e);
      }
    }));

    this.unsubs.push(this.eventBus.on('FILE_DELETED', (payload) => {
      const path = safePath(payload.path);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', payload.path); return; }

      this.vfs.deleteNode(path);
      // Instantly remove from the UI
      this.eventBus.emit('VFS_TREE_UPDATED', { tree: this.vfs.getNestedTree() });

      // INSTEAD OF CLOSING IT, WE INVALIDATE IT:
      this.dispatch({ type: 'MARK_DELETED', payload: { path, isDeleted: true } });
    }));

    this.unsubs.push(this.eventBus.on('FILE_RENAMED', ({ oldPath: rawOld, newPath: rawNew }) => {
      const oldPath = safePath(rawOld);
      const newPath = safePath(rawNew);
      if (!oldPath || !newPath) { console.warn('[Controller] Rejected unsafe rename:', rawOld, '->', rawNew); return; }

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

  // TODO: make this more robust by actually analyzing the file content or using a library like 'highlight.js' instead of just relying on file extensions
  // In essence build an engine
  /**
   * Maps file extensions to Monaco Editor's internal language identifiers.
   * Ensures the editor applies the correct syntax highlighting and language server rules.
   */
  private guessLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      // Web
      'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript',
      'ts': 'typescript', 'tsx': 'typescript',
      'html': 'html', 'htm': 'html',
      'css': 'css', 'scss': 'scss', 'less': 'less',
      'json': 'json',
      
      // Backend & Systems
      'py': 'python', 'pyw': 'python',
      'java': 'java',
      'c': 'c', 'h': 'c',
      'cpp': 'cpp', 'hpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      
      // Configs & Scripts
      'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',
      'yaml': 'yaml', 'yml': 'yaml',
      'xml': 'xml',
      'sql': 'sql',
      'md': 'markdown',
      'dockerfile': 'dockerfile',
      'env': 'plaintext', 'gitignore': 'plaintext'
    };

    // Special cases for files without standard extensions (e.g., 'Dockerfile')
    const filename = path.split('/').pop()?.toLowerCase();
    if (filename === 'dockerfile') return 'dockerfile';
    if (filename === 'makefile') return 'makefile';

    return languageMap[ext || ''] || 'plaintext';
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