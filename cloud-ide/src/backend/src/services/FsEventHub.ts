// A tiny per-sandbox pub/sub for filesystem-change notifications. The chokidar
// watcher (Step 10c) publishes; the SSE endpoint (GET /api/fs/:id/events)
// subscribes and streams to the browser, which patches its file tree.
//
// ponytail: one EventEmitter keyed by sandboxId — no rooms/registry needed for a
// single-node gateway. If the gateway ever fans out across nodes, back this with
// Redis pub/sub behind the same subscribe/publish surface.
import { EventEmitter } from 'events';

/** One tree-shape change chokidar observed, mapped to a container-visible path. */
export interface FsChange {
  kind: 'add' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string; // workspace-absolute, e.g. /workspace/src/app.ts
}

// A patch carries the exact paths that changed so the client can apply a
// surgical, dirty-preserving update. reload_tree stays as a coarse fallback
// (full re-hydrate) for callers that don't have per-path detail.
export type FsEvent =
  | { type: 'FS_EVENT'; action: 'reload_tree' }
  | { type: 'FS_EVENT'; action: 'patch'; changes: FsChange[] };

const RELOAD: FsEvent = { type: 'FS_EVENT', action: 'reload_tree' };

/**
 * Collapse a debounce window's raw changes to one entry per path — last event
 * wins. Create-then-delete of the same path inside the window nets to its final
 * state; a path is only ever a file or a dir, so keying on path is unambiguous.
 * Pure + lives here (next to FsChange, no chokidar import) so it stays the
 * atomic hot path AND a trivially unit-testable self-check target.
 */
export function coalesce(changes: FsChange[]): FsChange[] {
  const byPath = new Map<string, FsChange>();
  for (const change of changes) byPath.set(change.path, change);
  return Array.from(byPath.values());
}

export class FsEventHub {
  private emitter = new EventEmitter();

  constructor() {
    // Many SSE clients may watch the same sandbox — lift the leak-warning cap.
    this.emitter.setMaxListeners(0);
  }

  /** Subscribe to a sandbox's FS events; returns an unsubscribe fn. */
  subscribe(sandboxId: string, listener: (event: FsEvent) => void): () => void {
    this.emitter.on(sandboxId, listener);
    return () => this.emitter.off(sandboxId, listener);
  }

  /** Notify every subscriber of a sandbox that its tree changed. */
  publish(sandboxId: string, event: FsEvent = RELOAD): void {
    this.emitter.emit(sandboxId, event);
  }
}
