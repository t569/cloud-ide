// backend/src/api/PtyGateway.ts
//
// The provider-agnostic interactive-terminal bridge (TERMINAL_BACKEND.md Phase 2,
// step 3). A WebSocket at `/api/v1/sandboxes/:id/pty` is bridged to an
// ISandboxSession from whatever driver is active — so ANY PTY-capable provider
// (an Alibaba-SDK driver, or a future execd /session) lights this up with zero
// changes here. Today no driver advertises pty, so the route rejects with 1011
// and the frontend factory stays on line-mode SSE — no behavior change.
//
// Wire protocol (matches WebSocketTransport), disambiguated by FRAME TYPE:
//   • binary frame = raw stdin (in) / stdout+stderr (out)
//   • text frame   = JSON control: {type:'resize',cols,rows} in, {type:'exit',code} out
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { ISandboxRepository } from '../database/interfaces';
import { ISandboxSession } from '../services/sandbox/drivers/ISandboxDriver';
import { userOwnsSandbox } from './middleware/security';
import { readUserId } from './middleware/auth';
import { config } from '../config/env';

const PTY_PATH = /^\/api\/v1\/sandboxes\/([a-zA-Z0-9_-]+)\/pty$/;

// The subset of the ws socket the bridge touches — structural so tests can fake it.
export interface PtySocket {
  readonly readyState: number;
  send(data: string | Buffer, opts?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

/**
 * Pipe a live sandbox session onto a WebSocket. Pure w.r.t. transport wiring
 * (no server/driver deps) so it is unit-testable with fakes. Exported for that.
 */
export function bridgeSession(ws: PtySocket, session: ISandboxSession): void {
  // sandbox → browser: raw bytes as binary; exit as a text control frame.
  session.onData((chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
  });
  session.onExit((code) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'exit', code }));
    ws.close();
  });

  // browser → sandbox: binary = stdin; text = JSON control (resize).
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      session.write(data.toString('utf8'));
      return;
    }
    try {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        session.resize(msg.cols, msg.rows);
      }
    } catch {
      // ignore malformed control frames
    }
  });

  ws.on('close', () => session.close());
  ws.on('error', () => session.close());
}

interface PtyGatewayDeps {
  sandboxManager: SandboxManager;
  sandboxRepo: ISandboxRepository;
}

/**
 * Attach the PTY WebSocket bridge to the gateway's HTTP server. Enforces the
 * SAME sandbox-ownership (IDOR) rule as the REST/SSE routes on the upgrade
 * handshake, then hands the socket to a driver session.
 */
export function attachPtyGateway(server: http.Server, deps: PtyGatewayDeps): void {
  const { sandboxManager, sandboxRepo } = deps;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = PTY_PATH.exec(url.pathname);
    // Only our PTY route is a WebSocket endpoint today; anything else is closed.
    // A future WS route would branch here instead of destroying.
    if (!match) {
      socket.destroy();
      return;
    }

    // Cross-Site WebSocket Hijacking: the upgrade handshake is NOT covered by CORS
    // and carries cookies, so any origin could otherwise open a shell in a
    // logged-in user's sandbox. SameSite=Lax on `uid` mostly blocks this; check the
    // Origin anyway (defense in depth, and non-browser clients ignore SameSite).
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
        wss.handleUpgrade(req, socket, head, (ws) => {
          void startSession(ws, sandboxManager, sandboxId, { cols, rows });
        });
      })
      .catch(() => socket.destroy());
  });
}

async function startSession(
  ws: WebSocket,
  sandboxManager: SandboxManager,
  sandboxId: string,
  size: { cols: number; rows: number },
): Promise<void> {
  if (!sandboxManager.capabilities().pty) {
    ws.close(1011, 'Interactive PTY not supported by the active sandbox driver');
    return;
  }
  try {
    const session = await sandboxManager.openTerminalSession(sandboxId, size);
    bridgeSession(ws, session);
  } catch (err: any) {
    console.error(`[PtyGateway] openSession failed for ${sandboxId}:`, err?.message);
    ws.close(1011, 'Failed to open terminal session');
  }
}
