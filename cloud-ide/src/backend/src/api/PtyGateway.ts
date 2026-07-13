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
// SHELLS OUTLIVE SOCKETS. The PTY lifecycle is decoupled from the WebSocket lifecycle: a
// `PtyRegistry` keeps the shell alive when the socket drops — whether from a network blip
// OR the user closing the terminal tab — keyed by `sandboxId + termId`. A reconnect with
// the same termId re-binds to the SAME shell and replays whatever it printed while detached.
// This is what lets you run a dev server, close the terminal, keep coding, and reopen the
// terminal to find it still serving (with its output intact). A detached shell is reaped
// only when: the shell process exits (`exit`/Ctrl-D — the deliberate "kill it" path), the
// sandbox is destroyed, or the per-sandbox cap evicts an old detached one.
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

/** Does this upgrade belong to the PTY bridge? (Used by the server's dispatcher.) */
export function isPtyUpgrade(pathname: string): boolean {
  return PTY_PATH.test(pathname);
}

const WS_OPEN = 1; // WebSocket.OPEN — local const so the registry is testable without ws

// A dev server started in a terminal must OUTLIVE its terminal tab — that is what "coding
// with a live server" needs. So a closed socket (tab closed OR a network drop) no longer
// kills the shell: it is kept alive and reattachable by termId. It dies only when the shell
// itself exits (`exit`/Ctrl-D), the sandbox is destroyed (its container takes the shell with
// it), or the per-sandbox cap evicts an old detached one. A paused (idle) sandbox freezes
// the shell at zero compute cost, so a forgotten one is cheap.
//
// Cap on output buffered while detached, so a chatty dev server can't grow unbounded. Oldest
// bytes drop past this — a reattach shows a small gap, not an OOM.
const DETACHED_BUFFER_MAX = Number(process.env.PTY_DETACH_BUFFER_MAX) || 1_000_000;
// Bound on shells per sandbox, so closed-and-forgotten terminals can't pile up. Only
// DETACHED shells are ever evicted (oldest first); an attached, active terminal never is.
const MAX_TERMINALS_PER_SANDBOX = Number(process.env.PTY_MAX_PER_SANDBOX) || 8;

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
  detachedAt: number | null;     // when the socket dropped; null while attached (for LRU eviction)
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

  // Injectable so the eviction logic is testable without spinning up the default of 8.
  constructor(private maxPerSandbox: number = MAX_TERMINALS_PER_SANDBOX) {}

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
    const live: LiveTerminal = { session, ws: null, buffer: [], bufferedBytes: 0, detachedAt: null, exited: false };
    this.terminals.set(key, live);
    // Wire the shell's output/exit ONCE; only the socket binding changes per (re)connect.
    session.onData((chunk) => this.onOutput(live, chunk));
    session.onExit((code) => this.onExit(key, live, code));
    this.bind(key, live, ws);
    this.evictOverCap(key);
  }

  /**
   * Keep detached shells for one sandbox under the cap. The key is `${sandboxId} ${termId}`,
   * so terminals of a sandbox share its id prefix. Evict the OLDEST detached ones — never an
   * attached, active terminal — until at or under the cap. This bounds forgotten shells
   * without ever yanking a live one out from under the user.
   */
  private evictOverCap(newKey: string): void {
    const sandboxId = newKey.split(' ')[0];
    const mine = [...this.terminals.entries()].filter(([k]) => k.split(' ')[0] === sandboxId);
    let over = mine.length - this.maxPerSandbox;
    if (over <= 0) return;

    const detachedOldestFirst = mine
      .filter(([, t]) => t.detachedAt !== null)
      .sort((a, b) => a[1].detachedAt! - b[1].detachedAt!);
    for (const [k, t] of detachedOldestFirst) {
      if (over-- <= 0) break;
      this.destroy(k, t);
    }
  }

  private bind(key: string, live: LiveTerminal, ws: PtySocket): void {
    if (live.ws && live.ws !== ws) live.ws.close(); // a newer socket supersedes a stale one
    live.detachedAt = null; // reattached — no longer a candidate for eviction
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

    ws.on('close', () => this.detach(key, live, ws));
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

  private detach(key: string, live: LiveTerminal, ws: PtySocket): void {
    if (live.ws !== ws) return; // a newer socket already took over; ignore the stale close
    live.ws = null;
    if (live.exited) return; // shell already gone; onExit did the cleanup

    // The socket dropped (tab closed OR network blip) — but the SHELL stays alive so a dev
    // server running in it keeps serving. It is reattachable by termId; reaped only on shell
    // exit, sandbox destroy, or cap eviction. `detachedAt` marks it as an eviction candidate.
    live.detachedAt = Date.now();
  }

  private destroy(key: string, live: LiveTerminal): void {
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
    // Not ours — RETURN, do not destroy. Node fires every 'upgrade' listener, so
    // destroying here would kill sockets belonging to another handler (the preview
    // ingress's hot-reload socket is the one this used to break). server.ts closes
    // whatever no handler claims.
    if (!match) return;

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
