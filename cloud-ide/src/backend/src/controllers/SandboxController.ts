import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { Request, Response } from 'express';
import {
  SandboxExecRequest,
  SandboxSpec,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { DirtyWorktreeError, SandboxManager } from '../services/sandbox/SandboxManager';
import { ISessionRepository } from '../database/interfaces';
import { currentUser } from '../api/middleware/auth';


/**
 * @class SandboxController
 * @description The Express.js transport layer for Sandbox operations.
 * Handles HTTP request validation, error boundary management, and 
 * streaming Server-Sent Events (SSE) back to the client UI.
 */
export class SandboxController {
  constructor(
    private sandboxManager: SandboxManager,
    private sessionRepo: ISessionRepository,
  ) {}

  public createSandbox = async (req: Request, res: Response): Promise<void> => {
    const spec = req.body as SandboxSpec;

    if (!spec?.imageTag || typeof spec.imageTag !== 'string') {
      res.status(400).json({ error: 'imageTag is required.' });
      return;
    }

    try {
      // The caller becomes the owner. Taken from the identity seam, not the body:
      // whoever provisions it is the only one who may later reach it.
      // `environmentId` is stripped: it is the key warm-sandbox reuse matches on, and
      // this raw verb is launched from no environment. A body-supplied one would let a
      // caller graft a sandbox of any image onto an environment's reuse group.
      const { environmentId: _ignored, ...safeSpec } = spec;
      const sandbox = await this.sandboxManager.provision(safeSpec, currentUser(req, res));
      res.status(201).json(sandbox);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  /** GET /api/v1/sandboxes — this user's sandboxes, for the /sandboxes page (12a). */
  public listSandboxes = async (req: Request, res: Response): Promise<void> => {
    try {
      const records = await this.sandboxManager.listForOwner(currentUser(req, res));
      res.json(
        records.map((sbx) => ({
          sandboxId: sbx.sandboxId,
          environmentId: sbx.environmentId,
          state: sbx.state,
          createdAt: sbx.createdAt,
          lastActiveAt: sbx.lastActiveAt ?? sbx.createdAt,
        })),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * GET /api/v1/sandboxes/:sandboxId/sessions — the browser attachments to this
   * sandbox, newest first. A session is NOT the sandbox: many can share one, and
   * ending a session never destroys the compute (the IdleSweeper owns that). This
   * is what makes the sandbox↔session distinction legible in the UI. Owner-gated by
   * the router's requireSandboxOwnership, same as every other :sandboxId route.
   */
  public listSessions = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    try {
      const sessions = await this.sessionRepo.getSessionsBySandboxId(sandboxId);
      res.json(
        sessions
          .sort((a, b) => b.connectedAt - a.connectedAt)
          .map((s) => ({
            sessionId: s.sessionId,
            userId: s.userId,
            state: s.state,
            connectedAt: s.connectedAt,
            lastActiveAt: s.lastPingAt,
          })),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public getSandboxStatus = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    try {
      const status = await this.sandboxManager.getStatus(sandboxId);
      res.status(200).json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };


  /**
   * @description Executes a shell command inside the container and streams 
   * the output in real-time.
   * * Architecture Highlights:
   * 1. **Wake-on-Demand**: Intercepts commands sent to PAUSED containers and 
   * seamlessly thaws them via cgroups before routing the traffic.
   * 2. **Proxy Resolution**: Asks Rust for the internal routing proxy URL.
   * 3. **Streaming Bridge**: Pipes the Go `execd` SSE stream directly to the 
   * Express Response object for ultra-low latency terminal rendering.
   * 4. **Memory Safety**: Uses an `AbortController` to sever the internal 
   * Docker HTTP stream immediately if the client disconnects.
   */
  public execCommand = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);
    const payload = req.body as SandboxExecRequest;

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    if (!Array.isArray(payload?.command) || payload.command.length === 0) {
      res.status(400).json({ error: 'command must be a non-empty string array.' });
      return;
    }

    const abortController = new AbortController();
    // NOT `req.on('close')`. Since Node 16 IncomingMessage emits 'close' when the
    // REQUEST has been fully read — and express.json() drains the body before this
    // handler runs — so that fires immediately and aborted every exec ("The
    // operation was aborted"). `res` closes when the client actually goes away;
    // writableFinished distinguishes that from our own normal end().
    res.on('close', () => {
      if (!res.writableFinished) abortController.abort();
    });

    try {
      // WAKE-ON-DEMAND ARCHITECTURE
      const status = await this.sandboxManager.getStatus(sandboxId);

      if (status.state === 'PAUSED') {
        console.log(`[Gateway] Auto-resuming sleeping sandbox: ${sandboxId}`);
        await this.sandboxManager.resume(sandboxId);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // A freshly-created sandbox reports RUNNING before execd finishes booting
      // inside the container, so the very FIRST exec can hit a proxy that refuses the
      // connection (ECONNREFUSED) or a not-yet-ready 5xx/404 — the "first command in a
      // new terminal returns nothing" race. Retry the connect for a few seconds; execd
      // comes up quickly. Only the CONNECT is retried (no bytes streamed yet), so the
      // command can never run twice.
      const execBody = JSON.stringify({
        command: payload.command.join(' '),
        cwd: payload.cwd || '/workspace',
        env: payload.env || {},
      });

      let response: globalThis.Response | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 12; attempt++) {
        if (abortController.signal.aborted) return;
        try {
          const connection = await this.sandboxManager.resolveExecConnection(sandboxId);
          if (attempt === 0) console.log(`\n🔗 [Gateway] Connecting to Proxy: ${connection.baseUrl}`);
          response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}/command`, {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream',
              'Content-Type': 'application/json',
              ...(connection.accessToken ? { 'X-EXECD-ACCESS-TOKEN': connection.accessToken } : {}),
            },
            body: execBody,
            signal: abortController.signal,
          });
          if (response.ok) break;
          // Proxy/execd still booting → back off and retry. A real 4xx falls through.
          if (response.status >= 500 || response.status === 404) {
            lastErr = new Error(`execd not ready: ${response.status}`);
            response = undefined;
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          break;
        } catch (err: any) {
          if (err?.name === 'AbortError') return; // client disconnected mid-retry
          lastErr = err; // ECONNREFUSED while execd is still coming up
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!response) {
        res.status(503).json({ error: `Sandbox exec endpoint not ready: ${(lastErr as Error)?.message ?? 'unknown'}` });
        return;
      }
      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).json({ error: errorText || response.statusText });
        return;
      }

      if (!response.body) {
        res.status(502).json({ error: 'Exec stream was empty.' });
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const stream = Readable.fromWeb(response.body as any);
      stream.on('error', (error) => {
        if (!res.headersSent) {
          res.status(502).json({ error: String(error) });
          return;
        }
        res.end();
      });
      
      stream.pipe(res);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.end();
      }
    }
  };

  public pauseSandbox = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    try {
      await this.sandboxManager.pause(sandboxId);
      res.status(200).json({ sandboxId, state: 'PAUSED' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public resumeSandbox = async (req: Request, res: Response): Promise<void> => {
   const sandboxId = this.getStringParam(req.params.sandboxId);

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    try {
      await this.sandboxManager.resume(sandboxId);
      res.status(200).json({ sandboxId, state: 'RUNNING' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public destroySandbox = async (req: Request, res: Response): Promise<void> => {
      const sandboxId = this.getStringParam(req.params.sandboxId);

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    const force = req.query.force === 'true';

    try {
      await this.sandboxManager.destroy(sandboxId, force);
      res.status(200).json({ sandboxId, destroyed: true });
    } catch (error: any) {
      // Dirty-worktree pre-flight rejection (1b) is a conflict, not a server fault
      const status = error instanceof DirtyWorktreeError ? 409 : 500;
      res.status(status).json({ error: error.message });
    }
  };

  public attachVolume = async (req: Request, res: Response): Promise<void> => {
   const sandboxId = this.getStringParam(req.params.sandboxId);
    const volume = req.body as VolumeMount;

    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    if (!volume?.name || !volume?.hostPath) {
      res.status(400).json({ error: 'Volume name and hostPath are required.' });
      return;
    }

    try {
      const result = await this.sandboxManager.attachVolume(sandboxId, {
        ...volume,
        kind: 'user',
      });
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public detachVolume = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);
    const volumeName = this.getStringParam(req.params.volumeName);

    if (!sandboxId || !volumeName) {
      res.status(400).json({ error: 'sandboxId and volumeName are required.' });
      return;
    }

    try {
      const result = await this.sandboxManager.detachVolume(sandboxId, volumeName);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * GET /api/v1/sandboxes/:sandboxId/logs — live container logs (`docker logs -f`),
   * streamed as plain text. Owner-gated by the router, like every :sandboxId route.
   *
   * The container's PID 1 is `sleep infinity`, so a healthy sandbox is quiet here —
   * this is mainly where boot/exit failures surface (the exit-255 class we keep
   * hitting). Per-command output goes through /exec, not the container log.
   *
   * ponytail: shells out to the docker CLI directly. The gateway is colocated with
   * dockerd (WSL) — the same assumption bind mounts and exec already make. A
   * non-docker driver would need a logs() on ISandboxDriver; add it with the 2nd driver.
   */
  public streamLogs = async (req: Request, res: Response): Promise<void> => {
    const sandboxId = this.getStringParam(req.params.sandboxId);
    if (!sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }

    // Array args (not a shell string) — sandboxId can never inject a flag/command.
    const child = spawn('docker', ['logs', '--tail', '200', '--timestamps', '-f', `sandbox-${sandboxId}`]);

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // docker sends the container's stdout to its stdout and the container's stderr
    // (plus docker's own errors, e.g. "No such container") to stderr — show both.
    child.stdout.on('data', (d) => res.write(d));
    child.stderr.on('data', (d) => res.write(d));
    child.on('error', (err) => res.end(`\n[logs unavailable: ${String(err)}]\n`));
    child.on('close', () => res.end());

    // Drawer closed / navigated away → stop following so we don't leak a
    // `docker logs -f` process per view.
    res.on('close', () => child.kill('SIGKILL'));
  };

   private getStringParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}