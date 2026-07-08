// A tiny per-sandbox pub/sub for filesystem-change notifications. The chokidar
// watcher (Step 10c) publishes; the SSE endpoint (GET /api/fs/:id/events)
// subscribes and streams to the browser, which re-hydrates its file tree.
//
// ponytail: one EventEmitter keyed by sandboxId — no rooms/registry needed for a
// single-node gateway. If the gateway ever fans out across nodes, back this with
// Redis pub/sub behind the same subscribe/publish surface.
import { EventEmitter } from 'events';

export interface FsEvent {
  type: 'FS_EVENT';
  action: 'reload_tree';
}

const RELOAD: FsEvent = { type: 'FS_EVENT', action: 'reload_tree' };

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
