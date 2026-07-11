// backend/src/api/PtyGateway.ts
//
// The provider-agnostic interactive-terminal bridge (TERMINAL_BACKEND.md Phase 2).
// A WebSocket at `/api/v1/sandboxes/:id/pty?termId=<id>` is bridged to an
// ISandboxSession from whatever driver is active — so ANY PTY-capable provider
// lights this up with zero changes here.
//
// Wire protocol (matches WebSocketTransport), disambiguated by FRAME TYPE:
//   • binary frame = raw stdin (in) / stdout+stderr (out)
//   • text frame   = JSON control: {type:'resize',cols,rows} in, {type:'exit',code} out
//
// REATTACH ACROSS SOCKET DROPS (step 6). The PTY lifecycle is decoupled from the
// WebSocket lifecycle: a `PtyRegistry` keeps the shell alive for a grace period after
// the socket drops, keyed by `sandboxId + termId`. A reconnect with the same termId
// re-binds to the SAME shell and replays whatever it printed while detached — so a
// network blip / laptop sleep no longer resets your `vim`, `tail -f`, or dev server. A
// clean close (the user closing the tab, code 1000) kills it immediately instead.
import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { ISandboxRepository } from '../database/interfaces';
import { ISandboxSession } from '../services/sandbox/drivers/ISandboxDriver';
import { userOwnsSandbox } from './middleware/security';
import { readUserId } from './middleware/auth';
import { config } from '../config/env';

const PTY_PATH = /^\/api\/v1\/sandboxes\/([a-zA-Z0-9_-]+)\/pty$/;

const WS_OPEN = 1; // WebSocket.OPEN — local const so the registry is testable without ws
const WS_NORMAL_CLOSE = 1000; // clean close (tab closed) ⇒ kill the shell now, no grace

// How long a detached shell is kept alive waiting for a reconnect. Long enough to ride
// out a sleep/blip, short enough that abandoned shells don't hoard compute.
const DETACH_GRACE_MS = Number(process.env.PTY_DETACH_GRACE_MS) || 60_000;
// Cap on output buffered while detached, so a runaway `yes` can't grow unbounded. The
// oldest bytes are dropped past this — a reconnect then shows a small gap, not an OOM.
const DETACHED_BUFFER_MAX = Number(process.env.PTY_DETACH_BUFFER_MAX) || 1_000_000;

// The subset of the ws socket the bridge touches — structural so tests can fake it.
export interface PtySocket {
  readonly readyState: number;
  send(data: string | Buffer, opts?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

interface LiveTerminal {
  session: ISandboxSession;
  ws: PtySocket | null;          // null while detached
  buffer: Buffer[];              // output emitted while detached, replayed on reattach
  bufferedBytes: number;
  grace: ReturnType<typeof setTimeout> | null;
  exited: boolean;               // shell process ended — do not keep alive
}

/**
 * Owns the live PTYs and the reattach logic. Pure w.r.t. the HTTP server (fakeable
 * sockets/sessions), so the drop→grace→reconnect→replay lifecycle is unit-tested.
 *
 * ponytail: single-node, in-memory map. No hard cap on live terminals — the detach
 * grace bounds zombies in practice (a handful of tabs, each self-cleaning in ~60s).
 * If the gateway ever spans nodes or opens terminals programmatically at scale, this
 * moves to shared state with an explicit cap.
 */
export class PtyRegistry {
  private terminals = new Map<string, LiveTerminal>();

  /** Live terminal count — for tests/introspection. */
  get size(): number {
    return this.terminals.size;
  }

  /**
   * Bind `ws` to the terminal for `key`: reattach to a live shell if one exists
   * (replaying buffered output), else create one via `openSession`.
   */
  async attach(
    key: string,
    ws: PtySocket,
    openSession: () => Promise<ISandboxSession>,
  ): Promise<void> {
    const existing = this.terminals.get(key);
    if (existing && !existing.exited) {
      this.bind(key, existing, ws); // reattach to the running shell
      return;
    }

    const session = await openSession();
    const live: LiveTerminal = { session, ws: null, buffer: [], bufferedBytes: 0, grace: null, exited: false };
    this.terminals.set(key, live);
    // Wire the shell's output/exit ONCE; only the socket binding changes per (re)connect.
    session.onData((chunk) => this.onOutput(live, chunk));
    session.onExit((code) => this.onExit(key, live, code));
    this.bind(key, live, ws);
  }

  private bind(key: string, live: LiveTerminal, ws: PtySocket): void {
    if (live.ws && live.ws !== ws) live.ws.close(); // a newer socket supersedes a stale one
    if (live.grace) {
      clearTimeout(live.grace);
      live.grace = null;
    }
    live.ws = ws;

    // Replay whatever the shell printed while detached, in order, then resume live.
    if (live.buffer.length) {
      for (const chunk of live.buffer) {
        if (ws.readyState === WS_OPEN) ws.send(chunk, { binary: true });
      }
      live.buffer = [];
      live.bufferedBytes = 0;
    }

    // browser → shell: binary = stdin; text = JSON control (resize).
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        live.session.write(data.toString('utf8'));
        return;
      }
      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          live.session.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed control frames
      }
    });

    ws.on('close', (code?: number) => this.detach(key, live, ws, code));
    // 'error' is always followed by 'close' on the ws socket, so let detach() handle it.
    ws.on('error', () => {});
  }

  private onOutput(live: LiveTerminal, chunk: Buffer): void {
    if (live.ws && live.ws.readyState === WS_OPEN) {
      live.ws.send(chunk, { binary: true });
      return;
    }
    // Detached: buffer so a reconnect can replay the gap; ring-drop oldest past the cap.
    live.buffer.push(chunk);
    live.bufferedBytes += chunk.length;
    while (live.bufferedBytes > DETACHED_BUFFER_MAX && live.buffer.length > 1) {
      live.bufferedBytes -= live.buffer.shift()!.length;
    }
  }

  private onExit(key: string, live: LiveTerminal, code: number): void {
    live.exited = true;
    if (live.ws && live.ws.readyState === WS_OPEN) {
      live.ws.send(JSON.stringify({ type: 'exit', code }));
      live.ws.close();
    }
    this.destroy(key, live);
  }

  private detach(key: string, live: LiveTerminal, ws: PtySocket, code?: number): void {
    if (live.ws !== ws) return; // a newer socket already took over; ignore the stale close
    live.ws = null;
    if (live.exited) return; // shell already gone; onExit did the cleanup

    // Clean intentional close (tab closed) → reclaim now. Abnormal drop → hold the shell
    // for a reconnect, then reap if none comes.
    if (code === WS_NORMAL_CLOSE) {
      this.destroy(key, live);
      return;
    }
    live.grace = setTimeout(() => this.destroy(key, live), DETACH_GRACE_MS);
  }

  private destroy(key: string, live: LiveTerminal): void {
    if (live.grace) {
      clearTimeout(live.grace);
      live.grace = null;
    }
    if (!live.exited) live.session.close();
    this.terminals.delete(key);
  }
}

interface PtyGatewayDeps {
  sandboxManager: SandboxManager;
  sandboxRepo: ISandboxRepository;
}

/**
 * Attach the PTY WebSocket bridge to the gateway's HTTP server. Enforces the SAME
 * sandbox-ownership (IDOR) rule as the REST/SSE routes on the upgrade handshake,
 * then hands the socket to the reattach-aware registry.
 */
export function attachPtyGateway(server: http.Server, deps: PtyGatewayDeps): void {
  const { sandboxManager, sandboxRepo } = deps;
  const registry = new PtyRegistry();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = PTY_PATH.exec(url.pathname);
    // Only our PTY route is a WebSocket endpoint today; anything else is closed.
    if (!match) {
      socket.destroy();
      return;
    }

    // Cross-Site WebSocket Hijacking: the upgrade handshake is NOT covered by CORS
    // and carries cookies, so any origin could otherwise open a shell in a logged-in
    // user's sandbox. Check the Origin (defense in depth alongside SameSite=Lax).
    const origin = req.headers.origin;
    if (origin !== config.FRONTEND_ORIGIN) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const sandboxId = match[1];

    // readUserId, not currentUser: an upgrade has no Response to set a cookie on,
    // and a caller with no identity must be refused, not handed a fresh one.
    void userOwnsSandbox(sandboxRepo, readUserId(req.headers.cookie), sandboxId)
      .then((owns) => {
        if (!owns) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
        const cols = Number(url.searchParams.get('cols')) || 80;
        const rows = Number(url.searchParams.get('rows')) || 24;
        // Stable per-tab id so a reconnect re-binds to the same shell. Absent ⇒ a
        // random key: still tracked, but never matched again (no reattach benefit).
        const termId = url.searchParams.get('termId') || randomUUID();
        wss.handleUpgrade(req, socket, head, (ws) => {
          void startSession(registry, ws, sandboxManager, sandboxId, termId, { cols, rows });
        });
      })
      .catch(() => socket.destroy());
  });
}

async function startSession(
  registry: PtyRegistry,
  ws: WebSocket,
  sandboxManager: SandboxManager,
  sandboxId: string,
  termId: string,
  size: { cols: number; rows: number },
): Promise<void> {
  if (!sandboxManager.capabilities().pty) {
    ws.close(1011, 'Interactive PTY not supported by the active sandbox driver');
    return;
  }
  const key = `${sandboxId} ${termId}`;
  try {
    await registry.attach(key, ws, () => sandboxManager.openTerminalSession(sandboxId, size));
  } catch (err: any) {
    console.error(`[PtyGateway] openSession failed for ${sandboxId}:`, err?.message);
    ws.close(1011, 'Failed to open terminal session');
  }
}
