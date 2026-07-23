// backend/src/services/sandbox/drivers/wasm/wasmExecdShim.ts
//
// A loopback stand-in for execd, so the terminal works on the WASM tier without editing
// the path that already works for Docker.
//
// Why this exists at all: SandboxController does NOT stream exec through the driver. It
// calls resolveExecConnection() for a baseUrl and `fetch`es `${baseUrl}/command` itself,
// then pipes the response straight to the browser. A wasm guest is a child process on this
// host with no URL, so rather than refactor a working controller for an experiment, the
// driver serves the one endpoint the controller expects.
//
// ⚠️ WIRE FORMAT: execd frames each event as a RAW JSON object on its own line — NOT
// `data: `-prefixed SSE, despite everyone involved saying `text/event-stream`. The
// controller pipes bytes through untouched, so this is a contract with the FRONTEND
// (terminal/transport/SseExecTransport.ts), which splits on newlines and JSON.parses each.
// Emitting real SSE here would render a blank terminal.
//
// Bound to 127.0.0.1 on an ephemeral port and gated by a per-process token: on a shared
// host, any local process could otherwise POST to it and exec inside any sandbox.

import http from 'node:http';
import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';

/** What the shim needs from the driver — kept narrow so it is trivial to fake in a test. */
export interface ExecLineSource {
  execLines(
    sandboxId: string,
    command: string[],
    env: Record<string, string> | undefined,
    onLine: (type: 'stdout' | 'stderr', text: string) => void,
  ): Promise<number>;
}

/**
 * Turn the transport's shell-ish line into argv.
 *
 * SseExecTransport sends `export TERM=xterm-256color; <what the user typed>` because a real
 * shell needs TERM exported. There is no shell here, so the preamble is dropped and the
 * rest is split on whitespace.
 *
 * ponytail: no quoting, no pipes, no redirection, no globs, no `&&` — a whitespace split is
 * the honest ceiling when nothing provides shell semantics. Upgrade path is WASIX, which
 * has fork/exec and a real bash; at that point delete this and let the shell parse.
 */
export function argvFromShellish(line: string): string[] {
  const stripped = line.replace(/^\s*(?:export\s+[^;]*;\s*)+/, '');
  return stripped.trim().split(/\s+/).filter(Boolean);
}

export class WasmExecdShim {
  private server?: http.Server;
  private port = 0;
  /** Proves a request came from this process, not from anything else on localhost. */
  public readonly token = crypto.randomBytes(24).toString('hex');

  constructor(private source: ExecLineSource) {}

  /** Idempotent: the driver starts it lazily on the first resolveExecConnection. */
  public async start(): Promise<number> {
    if (this.server) return this.port;
    const server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The base the controller appends `/command` to. */
  public baseUrl(sandboxId: string): string {
    return `http://127.0.0.1:${this.port}/${encodeURIComponent(sandboxId)}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const match = /^\/([^/]+)\/command$/.exec((req.url ?? '').split('?')[0]);
    if (req.method !== 'POST' || !match) {
      res.writeHead(404).end();
      return;
    }
    // timingSafeEqual needs equal lengths, hence the length check first.
    const supplied = String(req.headers['x-execd-access-token'] ?? '');
    if (
      supplied.length !== this.token.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))
    ) {
      res.writeHead(403).end();
      return;
    }

    const sandboxId = decodeURIComponent(match[1]);
    let body = '';
    for await (const chunk of req) body += chunk;

    let parsed: { command?: unknown; env?: Record<string, string> };
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400).end();
      return;
    }

    // The controller joins the array into ONE shell string before sending it here.
    const argv = argvFromShellish(typeof parsed.command === 'string' ? parsed.command : '');
    if (!argv.length) {
      res.writeHead(400).end();
      return;
    }

    res.writeHead(200, {
      // Named for the controller's benefit; the bytes below are newline JSON, not SSE.
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const emit = (type: 'stdout' | 'stderr', text: string) => {
      res.write(`${JSON.stringify({ type, text })}\n`);
    };

    try {
      const exitCode = await this.source.execLines(sandboxId, argv, parsed.env, emit);
      if (exitCode !== 0) emit('stderr', `exited with code ${exitCode}`);
    } catch (err: any) {
      // A driver-level refusal (unknown program, missing module) is the user's answer, not
      // a 500 — the stream is already open, so it goes down the same channel.
      emit('stderr', String(err?.message ?? err));
    } finally {
      res.end();
    }
  }
}
