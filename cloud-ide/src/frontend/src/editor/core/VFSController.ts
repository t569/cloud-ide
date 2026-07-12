// frontend/src/editor/core/VFSController.ts
import { EditorEventBus } from './EditorEventBus';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem';
import { API_BASE_URL } from '../../config/env';
import { LanguageRegistry } from '../languages';
import React from 'react';

/** The container-visible workspace root — everything under it is editable; a path
 *  outside it is a read-only view into the container (see isExternal). */
const WORKSPACE_ROOT = '/workspace';

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

/** Is this path outside the workspace? Those files live only in the container,
 *  are opened read-only, and never enter the VFS map. Expects a safePath(). */
export function isExternal(path: string): boolean {
  return path !== WORKSPACE_ROOT && !path.startsWith(`${WORKSPACE_ROOT}/`);
}

/** Formats a browser renders natively — served as bytes from /fs/:id/raw and shown
 *  by ImageViewer. Reading one as text yields mojibake, so the open path skips the
 *  text fetch entirely for these. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];

export function isImage(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

/** The bytes endpoint for a workspace file — what an <img src> points at. */
export function rawFileUrl(sandboxId: string, path: string): string {
  return `${API_BASE_URL}/fs/${encodeURIComponent(sandboxId)}/raw?path=${encodeURIComponent(path)}`;
}

export class VFSController {
  private vfs: VirtualFileSystem;
  // An array to hold all our event un-subscribers to prevent memory leaks
  private unsubs: Array<() => void> = [];
  // Live SSE stream of backend filesystem changes (chokidar → re-hydrate).
  private fsEvents?: EventSource;

  constructor(
    private eventBus: EditorEventBus,
    private dispatch: React.Dispatch<any>,
    private sandboxId: string,
    private languages: LanguageRegistry
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
    this.connectFsEvents();
  }

  /**
   * Subscribes to the backend's FS change stream (SSE). When the workspace
   * changes on disk (npm install, git, an agent), the backend pushes the exact
   * changed paths and we patch the tree surgically.
   *
   *  - `patch`: apply the paths via vfs.applyPatch(), which preserves dirty
   *    nodes — safe to run even with unsynced edits pending (Tier 1).
   *  - `reload_tree`: coarse full re-hydrate fallback. It clears the map, so we
   *    still skip it while local edits are unsynced to avoid clobbering them.
   */
  private connectFsEvents() {
    const url = `${API_BASE_URL}/fs/${encodeURIComponent(this.sandboxId)}/events`;
    const source = new EventSource(url, { withCredentials: true });
    this.fsEvents = source;

    source.onmessage = async (e) => {
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return; // ignore heartbeats / malformed frames
      }

      if (msg?.action === 'patch' && Array.isArray(msg.changes)) {
        const tree = this.vfs.applyPatch(msg.changes);
        this.eventBus.emit('VFS_TREE_UPDATED', { tree });
        return;
      }

      if (msg?.action !== 'reload_tree') return;
      if (this.vfs.hasPendingSync()) {
        console.warn('[Controller] FS reload_tree ignored — unsynced local edits pending.');
        return;
      }
      const tree = await this.vfs.hydrateWorkspace();
      this.eventBus.emit('VFS_TREE_UPDATED', { tree });
    };

    // EventSource auto-reconnects on transient errors; nothing to do but note it.
    source.onerror = () => console.warn('[Controller] FS event stream interrupted; retrying…');
  }

  private initListeners() {
    // ==========================================
    // CORE FILE I/O ROUTING
    // ==========================================

    this.unsubs.push(this.eventBus.on('FILE_OPEN_REQUESTED', async ({ path: rawPath }) => {
      const path = safePath(rawPath);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', rawPath); return; }

      // A path outside /workspace (a terminal click on /etc/nginx.conf, a
      // go-to-definition into site-packages) isn't in the VFS map and never will
      // be — the map only mirrors the worktree. Read it straight from the
      // container, read-only. Previously this fell through to vfs.readFile(),
      // which prefixes /workspace, missed the map, threw, and left a blank tab
      // wedged in 'conflict' forever.
      const external = isExternal(path);

      // An image has no text to load: ImageViewer points an <img> straight at the
      // bytes route. Sending it through readFile() would decode a PNG as UTF-8 and
      // drop a screenful of mojibake into Monaco. Read-only — we have no editor for
      // pixels, and a text write-back would corrupt the file.
      if (isImage(path)) {
        this.dispatch({
          type: 'OPEN_FILE',
          payload: { path, readOnly: true, isImage: true },
        });
        return;
      }

      this.dispatch({ type: 'OPEN_FILE', payload: { path, readOnly: external } });
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'syncing' } });

      try {
        const content = external
          ? await this.vfs.readExternalFile(path)
          : await this.vfs.readFile(path);
        this.eventBus.emit('FILE_LOADED', { path, content, language: this.languages.detect(path) });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      } catch (error) {
        // Nothing to show (gone, binary, a directory, unreadable): close the tab
        // we optimistically opened rather than leaving an empty one behind.
        console.warn(`[Controller] Could not open ${path}:`, error);
        this.dispatch({ type: 'CLOSE_FILE', payload: { path } });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      }
    }));

    this.unsubs.push(this.eventBus.on('CONTENT_CHANGED', ({ path: rawPath, newContent }) => {
      const path = safePath(rawPath);
      if (!path) { console.warn('[Controller] Rejected unsafe path:', rawPath); return; }
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: true } });
      this.vfs.updateFile(path, newContent);
    }));

    this.unsubs.push(this.eventBus.on('SAVE_REQUESTED', async ({ path }) => {
      // forceSync() flushes the ENTIRE dirty queue regardless of path, so both
      // single-save and save-all just need to flush, then clear the dirty flag.
      await this.vfs.forceSync();
      if (path === 'ALL') {
        this.dispatch({ type: 'MARK_ALL_SAVED' });
      } else {
        this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: false } });
      }
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

  // ==========================================
  // CLEANUP (Prevents the Ghost Duplicate Logs)
  // ==========================================
  public destroy() {
    this.vfs.destroy();
    this.fsEvents?.close(); // stop the SSE stream + its auto-reconnect
    // Fire all the unsubscribe functions to detach from the EventBus
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
  }
}