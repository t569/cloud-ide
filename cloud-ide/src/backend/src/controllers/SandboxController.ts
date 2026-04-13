import { Readable } from 'node:stream';
import { Request, Response } from 'express';
import {
  SandboxExecRequest,
  SandboxSpec,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { SandboxManager } from '../services/sandbox/SandboxManager';

export class SandboxController {
  constructor(private sandboxManager: SandboxManager) {}

  public createSandbox = async (req: Request, res: Response): Promise<void> => {
    const spec = req.body as SandboxSpec;

    if (!spec?.imageTag || typeof spec.imageTag !== 'string') {
      res.status(400).json({ error: 'imageTag is required.' });
      return;
    }

    try {
      const sandbox = await this.sandboxManager.provision(spec);
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
    req.on('close', () => abortController.abort());

    try {
      const connection = await this.sandboxManager.resolveExecConnection(sandboxId);
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
          command: payload.command,
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

    try {
      await this.sandboxManager.destroy(sandboxId);
      res.status(200).json({ sandboxId, destroyed: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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