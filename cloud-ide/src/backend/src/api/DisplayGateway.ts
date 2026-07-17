// backend/src/api/DisplayGateway.ts
//
// The interactive-display bridge (display-streaming plan, slice 2 + stage-2 audio):
//
//   POST /api/v1/sandboxes/:id/display          → start Xvnc in the sandbox (idempotent)
//   WS   /api/v1/sandboxes/:id/display/stream   → raw RFB bytes,  WS ↔ TCP :5901 (noVNC)
//   WS   /api/v1/sandboxes/:id/display/audio    → raw s16le PCM,  WS ↔ TCP :4713 (AudioWorklet)
//
// Both WS paths are one row in TRANSPORTS and share ONE upgrade guard + ONE bridge().
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
import {
  RFB_PORT as RFB,
  AUDIO_PORT,
  startDisplay as startDisplayScript,
  startAudio as startAudioScript,
  DisplayStartResult,
} from '../services/sandbox/display';

// One row per media transport (display-streaming stage 2): a WS path → the
// container port it bridges to. Both share the SAME upgrade guard and bridge()
// pipe — adding a capability is adding a row here, nothing else moves.
const TRANSPORTS: { re: RegExp; port: number }[] = [
  { re: /^\/api\/v1\/sandboxes\/([a-zA-Z0-9_-]+)\/display\/stream$/, port: RFB },
  { re: /^\/api\/v1\/sandboxes\/([a-zA-Z0-9_-]+)\/display\/audio$/, port: AUDIO_PORT },
];

/** Match a media-transport upgrade; returns the sandboxId + target port. */
function matchTransport(pathname: string): { sandboxId: string; port: number } | null {
  for (const { re, port } of TRANSPORTS) {
    const m = re.exec(pathname);
    if (m) return { sandboxId: m[1], port };
  }
  return null;
}

export function isDisplayUpgrade(pathname: string): boolean {
  return matchTransport(pathname) !== null;
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

/** Start the sandbox's PCM audio tap (idempotent). Decoupled from startDisplay:
 *  callers fire it non-fatally, so no audio stack never breaks the display. */
export function startAudio(
  sandboxManager: SandboxManager,
  sandboxId: string,
): Promise<DisplayStartResult> {
  return startAudioScript((command) => sandboxManager.execBuffered(sandboxId, { command }));
}

// Backpressure bound (optimization store O3): a slow client makes ws.send() queue the
// framebuffer/PCM stream in ws.bufferedAmount without limit — an unbounded gateway
// memory leak, not just lag. RFB is a stateful incremental protocol, so we CANNOT drop
// bytes; instead pause the container read when the client's send buffer is high and
// resume once it drains (the ws.send flush callback is our "drain" signal). Byte order
// is preserved. ponytail: 4MB/1MB is a memory ceiling, not a latency knob — tune only
// if a real slow-client trace shows stutter, and per-frame drop-old is O1/O6, not here.
const WS_HIGH_WATER = 4 * 1024 * 1024; // pause reading from the container above this
const WS_LOW_WATER = 1 * 1024 * 1024; // resume once the client has drained below this

/**
 * Pipe one WebSocket to one TCP socket, byte-for-byte, until either side ends.
 * Exported pure-ish so the framing is unit-testable without a server.
 *
 * The container→client direction is bounded by pausing the TCP read under client
 * backpressure (O3). The client→container direction is human-rate input (mouse/keys),
 * so tcp.write's own kernel buffer is bound enough — no throttle needed there.
 */
export function bridge(ws: WebSocket, tcp: net.Socket): void {
  ws.on('message', (data: Buffer) => tcp.write(data));
  tcp.on('data', (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(chunk, { binary: true }, () => {
      // Flushed to the socket: if we throttled and the client has caught up, read on.
      if (tcp.isPaused() && ws.bufferedAmount <= WS_LOW_WATER) tcp.resume();
    });
    if (ws.bufferedAmount >= WS_HIGH_WATER) tcp.pause();
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
    const transport = matchTransport(url.pathname);
    if (!transport) return; // not ours — another handler (or the closer in server.ts) owns it

    // CSWSH: the handshake is outside CORS and carries cookies — refuse foreign origins.
    if (req.headers.origin !== config.FRONTEND_ORIGIN) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const { sandboxId, port } = transport;
    void userOwnsSandbox(sandboxRepo, readUserId(req.headers.cookie), sandboxId)
      .then(async (owns) => {
        if (!owns) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
        const ip = await containerIp(sandboxId);
        const tcp = net.connect(port, ip);
        tcp.once('error', () => socket.destroy()); // backend not up — the pane retries via POST /display
        tcp.once('connect', () => {
          wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, tcp));
        });
      })
      .catch(() => socket.destroy());
  });
}
