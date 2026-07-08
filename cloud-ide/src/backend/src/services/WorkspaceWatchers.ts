// Per-sandbox chokidar watcher on the host worktree. Demand-driven: a watcher
// starts when the first editor subscribes to the SSE stream (acquire) and stops
// when the last one disconnects (release), so we never watch a workspace nobody
// is viewing — and resumed/persisted sandboxes work without provision hooks. A
// debounced batch of tree-shape changes publishes a single reload_tree.
//
// The worktree is bind-mounted from the host, so we watch host files directly —
// no container exec, works even while the sandbox is PAUSED (matches the
// host-direct VFS in FileSystemManager). ponytail: single-node assumption — the
// gateway and worktrees share a disk.
import { watch, FSWatcher } from 'chokidar';
import { SandboxManager } from './sandbox/SandboxManager';
import { FsEventHub } from './FsEventHub';

const DEBOUNCE_MS = 300;

// Skip the huge/noisy trees; churn there shouldn't refresh the explorer.
const isIgnored = (p: string): boolean =>
  /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p);

interface WatchEntry {
  watcher: FSWatcher;
  refs: number;
  timer?: NodeJS.Timeout;
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

    const entry: WatchEntry = { watcher, refs: 1 };

    // Only tree-SHAPE changes need a reload; content edits ('change') don't move
    // the tree and would just echo the VFS's own file writes back at it.
    const onShapeChange = () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.hub.publish(sandboxId), DEBOUNCE_MS);
    };
    watcher
      .on('add', onShapeChange)
      .on('unlink', onShapeChange)
      .on('addDir', onShapeChange)
      .on('unlinkDir', onShapeChange);

    this.entries.set(sandboxId, entry);
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
