import { Readable } from 'node:stream';
import { Request, Response } from 'express';
import {
  SandboxExecRequest,
  SandboxSpec,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { DirtyWorktreeError, SandboxManager } from '../services/sandbox/SandboxManager';
import { currentUser } from '../api/middleware/auth';


/**
 * @class SandboxController
 * @description The Express.js transport layer for Sandbox operations.
 * Handles HTTP request validation, error boundary management, and 
 * streaming Server-Sent Events (SSE) back to the client UI.
 */
export class SandboxController {
  constructor(private sandboxManager: SandboxManager) {}

  public createSandbox = async (req: Request, res: Response): Promise<void> => {
    const spec = req.body as SandboxSpec;

    if (!spec?.imageTag || typeof spec.imageTag !== 'string') {
      res.status(400).json({ error: 'imageTag is required.' });
      return;
    }

    try {
      // The caller becomes the owner. Taken from the identity seam, not the body:
      // whoever provisions it is the only one who may later reach it.
      const sandbox = await this.sandboxManager.provision(spec, currentUser(req, res));
      res.status(201).json(sandbox);
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

      const connection = await this.sandboxManager.resolveExecConnection(sandboxId);
      
      // NEW: Diagnostic log to prove Rust gave us the right proxy URL
      console.log(`\n🔗 [Gateway] Connecting to Proxy: ${connection.baseUrl}`);

     const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}/command`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          ...(connection.accessToken
            ? { 'X-EXECD-ACCESS-TOKEN': connection.accessToken }
            : {}),
        },
        body: JSON.stringify({
          command: payload.command.join(' '), 
          cwd: payload.cwd || '/workspace',
          env: payload.env || {},
        }),
        signal: abortController.signal, 
      });

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

   private getStringParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}