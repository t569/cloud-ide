// Per-sandbox chokidar watcher on the host worktree. Demand-driven: a watcher
// starts when the first editor subscribes to the SSE stream (acquire) and stops
// when the last one disconnects (release), so we never watch a workspace nobody
// is viewing — and resumed/persisted sandboxes work without provision hooks. A
// debounced batch of tree-shape changes publishes a single coalesced patch.
//
// The worktree is bind-mounted from the host, so we watch host files directly —
// no container exec, works even while the sandbox is PAUSED (matches the
// host-direct VFS in FileSystemManager). ponytail: single-node assumption — the
// gateway and worktrees share a disk.
import path from 'node:path';
import { watch, FSWatcher } from 'chokidar';
import { SandboxManager } from './sandbox/SandboxManager';
import { FsEventHub, FsChange, coalesce } from './FsEventHub';

const DEBOUNCE_MS = 300;

// The container-visible root the frontend VFS keys everything under.
const WORKSPACE_ROOT = '/workspace';

// Skip the huge/noisy trees; churn there shouldn't refresh the explorer.
const isIgnored = (p: string): boolean =>
  /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p);

interface WatchEntry {
  watcher: FSWatcher;
  refs: number;
  timer?: NodeJS.Timeout;
  pending: FsChange[];
  toWorkspacePath: (abs: string) => string;
}

export class WorkspaceWatchers {
  private entries = new Map<string, WatchEntry>();

  constructor(
    private sandboxManager: SandboxManager,
    private hub: FsEventHub,
  ) {}

  /** Start (or ref-count) watching a sandbox's worktree. One call per SSE client. */
  async acquire(sandboxId: string): Promise<void> {
    const existing = this.entries.get(sandboxId);
    if (existing) {
      existing.refs++;
      return;
    }

    let hostPath: string;
    try {
      hostPath = await this.sandboxManager.getWorkspaceHostPath(sandboxId);
    } catch {
      return; // no worktree (unknown/destroyed sandbox) — nothing to watch
    }

    // Another acquire may have created the entry while we awaited above.
    const raced = this.entries.get(sandboxId);
    if (raced) {
      raced.refs++;
      return;
    }

    const watcher = watch(hostPath, {
      ignored: (p) => isIgnored(p),
      ignoreInitial: true, // don't fire for the existing tree on start
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const entry: WatchEntry = {
      watcher,
      refs: 1,
      pending: [],
      // chokidar hands us host-absolute paths; the frontend VFS keys on the
      // container path (/workspace/...). Map once, per entry.
      toWorkspacePath: (abs: string) =>
        WORKSPACE_ROOT + '/' + path.relative(hostPath, abs).split(path.sep).join('/'),
    };

    // Only tree-SHAPE changes need a patch; content edits ('change') don't move
    // the tree and would just echo the VFS's own file writes back at it.
    const record = (kind: FsChange['kind']) => (abs: string) => {
      entry.pending.push({ kind, path: entry.toWorkspacePath(abs) });
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const changes = coalesce(entry.pending);
        entry.pending = [];
        if (changes.length) this.hub.publish(sandboxId, { type: 'FS_EVENT', action: 'patch', changes });
      }, DEBOUNCE_MS);
    };
    watcher
      .on('add', record('add'))
      .on('unlink', record('unlink'))
      .on('addDir', record('addDir'))
      .on('unlinkDir', record('unlinkDir'));

    this.entries.set(sandboxId, entry);
  }

  /**
   * Is any browser currently holding this workspace open? An entry exists exactly
   * while >=1 SSE client is subscribed, and `release` runs on tab close, navigation
   * and socket death — so this is the liveness signal IdleSweeper wants. It needs no
   * heartbeat and cannot go stale: a crashed client's socket closes.
   */
  isViewed(sandboxId: string): boolean {
    return this.entries.has(sandboxId);
  }

  /** Drop a reference; when the last subscriber leaves, stop the watcher. */
  release(sandboxId: string): void {
    const entry = this.entries.get(sandboxId);
    if (!entry) return;
    if (--entry.refs > 0) return;
    if (entry.timer) clearTimeout(entry.timer);
    void entry.watcher.close();
    this.entries.delete(sandboxId);
  }
}
