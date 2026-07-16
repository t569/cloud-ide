// backend/src/api/DisplayGateway.ts
//
// The interactive-display bridge (display-streaming plan, slice 2). Two seams:
//
//   POST /api/v1/sandboxes/:id/display          → start Xvnc in the sandbox (idempotent)
//   WS   /api/v1/sandboxes/:id/display/stream   → raw RFB bytes, WS ↔ TCP :5901
//
// The browser runs the VNC client (@novnc/novnc); the gateway is a dumb pipe. No
// websockify in the container — this IS the websockify, on the `ws` dep we already
// carry for the PTY bridge. Upgrade auth mirrors PtyGateway exactly: Origin check
// (CSWSH) + cookie identity + sandbox ownership, 404 on failure so ids can't be
// enumerated.
//
// Trust model (same as a user's dev server, deliberately): Xvnc listens on the
// container interface with no RFB auth. Enforced deny-default egress drops
// cross-tenant raw-IP reach; on a degraded host the exposure equals a dev server's.
// See docs/plans/display-streaming.md.
import type http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { ISandboxRepository } from '../database/interfaces';
import { userOwnsSandbox } from './middleware/security';
import { readUserId } from './middleware/auth';
import { config } from '../config/env';

export { RFB_PORT, DISPLAY_NUM } from '../services/sandbox/display';
import { RFB_PORT as RFB, startDisplay as startDisplayScript, DisplayStartResult } from '../services/sandbox/display';

const STREAM_PATH = /^\/api\/v1\/sandboxes\/([a-zA-Z0-9_-]+)\/display\/stream$/;

export function isDisplayUpgrade(pathname: string): boolean {
  return STREAM_PATH.test(pathname);
}

/** Start the sandbox's virtual display (idempotent). Kept as the controller's
 *  entry point; the script itself lives in services/sandbox/display.ts so
 *  provision() can auto-start the display at boot without an import cycle. */
export function startDisplay(
  sandboxManager: SandboxManager,
  sandboxId: string,
): Promise<DisplayStartResult> {
  return startDisplayScript((command) => sandboxManager.execBuffered(sandboxId, { command }));
}

/**
 * Pipe one WebSocket to one TCP socket, byte-for-byte, until either side ends.
 * Exported pure-ish so the framing is unit-testable without a server.
 */
export function bridge(ws: WebSocket, tcp: net.Socket): void {
  ws.on('message', (data: Buffer) => tcp.write(data));
  tcp.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
  });
  const closeBoth = () => {
    tcp.destroy();
    if (ws.readyState === WebSocket.OPEN) ws.close();
  };
  ws.on('close', closeBoth);
  ws.on('error', closeBoth);
  tcp.on('close', closeBoth);
  tcp.on('error', closeBoth);
}

/**
 * The container's bridge-network IP, for a RAW TCP connection to Xvnc's RFB port.
 *
 * Why not resolveEndpoint(): the daemon's endpoint API returns an HTTP proxy path
 * (`127.0.0.1:<mapped>/proxy/<port>`) — fine for dev servers, useless for RFB,
 * which is not HTTP. With egress enforced the sandbox lives in the SIDECAR's
 * netns, so the sidecar owns the IP; without egress the sandbox container does.
 * ponytail: docker-specific (docker inspect) — add a driver seam for raw TCP
 * endpoints when a second provider needs the Display pane.
 */
function containerIp(sandboxId: string): Promise<string> {
  const inspect = (name: string) =>
    new Promise<string>((resolve, reject) =>
      execFile(
        'docker',
        ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name],
        (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
      ),
    );
  return inspect(`sandbox-egress-${sandboxId}`)
    .catch(() => '')
    .then((ip) => ip || inspect(`sandbox-${sandboxId}`));
}

interface DisplayGatewayDeps {
  sandboxManager: SandboxManager;
  sandboxRepo: ISandboxRepository;
}

export function attachDisplayGateway(server: http.Server, deps: DisplayGatewayDeps): void {
  const { sandboxRepo } = deps;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = STREAM_PATH.exec(url.pathname);
    if (!match) return; // not ours — another handler (or the closer in server.ts) owns it

    // CSWSH: the handshake is outside CORS and carries cookies — refuse foreign origins.
    if (req.headers.origin !== config.FRONTEND_ORIGIN) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const sandboxId = match[1];
    void userOwnsSandbox(sandboxRepo, readUserId(req.headers.cookie), sandboxId)
      .then(async (owns) => {
        if (!owns) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
        const ip = await containerIp(sandboxId);
        const tcp = net.connect(RFB, ip);
        tcp.once('error', () => socket.destroy()); // Xvnc not up — the pane retries via POST /display
        tcp.once('connect', () => {
          wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, tcp));
        });
      })
      .catch(() => socket.destroy());
  });
}
