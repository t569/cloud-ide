// backend/src/api/FileSystemRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { FileSystemManager } from '../services/FileSystemManager';
import { FsEventHub } from '../services/FsEventHub';
import { WorkspaceWatchers } from '../services/WorkspaceWatchers';
import { SessionStore } from '../services/SessionStore';
import { ISandboxRepository } from '../database/interfaces';
import { requireSandboxOwnership } from './middleware/security';

// The router is pure transport: it depends on the FileSystemManager it is
// given and knows nothing about how or where files are actually stored.
// sandboxRepo is injected so the router can enforce sandbox ownership (IDOR):
// the record names its owner, and the caller must be that owner.
// fsEventHub feeds the SSE change stream; watchers start/stop the chokidar
// watcher per SSE subscriber (GET /:id/events). sessionStore persists terminal
// scrollback for crash/reconnect recovery (Gap B) — sandbox-scoped, so it rides
// the same ownership guard as the file routes.
export function createFileSystemRouter(
  fsManager: FileSystemManager,
  sandboxRepo: ISandboxRepository,
  fsEventHub: FsEventHub,
  watchers: WorkspaceWatchers,
  sessionStore: SessionStore,
): Router {
  const router = Router();
  /**
   * PARAMETER VALIDATION MIDDLEWARE
   * Intercepts any route containing ':sandboxId' and validates it first.
   */
  router.param('sandboxId', (req: Request, res: Response, next: NextFunction, id: string) => {
    // 1. Check if it exists and is a string
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid sandboxId: Must be a string.' });
    }

    // 2. Prevent empty strings or whitespace-only strings
    if (id.trim() === '') {
      return res.status(400).json({ error: 'Invalid sandboxId: Cannot be empty.' });
    }

    // 3. Regex to ensure it only contains safe characters (alphanumeric, dashes, underscores).
    const safeIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!safeIdRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid sandboxId: Contains illegal characters.' });
    }

    // If it passes all checks, proceed to the actual route handler
    next();
  });

  // IDOR: every sandbox-scoped route requires that the caller own this sandbox.
  // Runs after the param validation above, before any handler.
  router.use('/:sandboxId', requireSandboxOwnership(sandboxRepo));

  /**
   * GET /api/fs/:sandboxId/ls?path=/workspace
   */
  router.get('/:sandboxId/ls', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const targetPath = (req.query.path as string) || '/workspace';

      if (!sandboxId || typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }

      const files = await fsManager.listDirectory(sandboxId, targetPath);
      res.status(200).json(files);
    } catch (error: any) {
      console.error(`[VFS Error] Failed to list directory: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/fs/:sandboxId/read?path=/workspace/index.js
   */
  router.get('/:sandboxId/read', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const filePath = req.query.path as string;

      if (!sandboxId || typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }
      if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({ error: 'Valid file path is required' });
      }

      const content = await fsManager.readFile(sandboxId, filePath);
      res.status(200).json({ content });
    } catch (error: any) {
      console.error(`[VFS Error] Failed to read file: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/fs/:sandboxId/write
   */
  router.post('/:sandboxId/write', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const { path: filePath, content } = req.body;

      if (!sandboxId || typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }
      if (!filePath || typeof filePath !== 'string' || content === undefined) {
        return res.status(400).json({ error: 'Valid file path and content are required' });
      }

      await fsManager.writeFile(sandboxId, filePath, String(content));
      res.status(200).json({ message: 'File written successfully' });
    } catch (error: any) {
      console.error(`[VFS Error] Failed to write file: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/fs/:sandboxId/events
   * Server-Sent Events: streams { type: 'FS_EVENT', action: 'reload_tree' } when
   * the sandbox's workspace changes on disk (chokidar watcher, Step 10c), so the
   * editor re-hydrates its tree. Ownership is enforced by the /:sandboxId guard.
   */
  router.get('/:sandboxId/events', (req: Request, res: Response) => {
    const { sandboxId } = req.params;
    if (typeof sandboxId !== 'string') {
      res.status(400).json({ error: 'Invalid Sandbox id' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n'); // open the stream immediately

    const unsubscribe = fsEventHub.subscribe(sandboxId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Start the chokidar watcher on demand (ref-counted across subscribers).
    void watchers.acquire(sandboxId);

    // Heartbeat so idle proxies/load balancers don't drop the connection.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      watchers.release(sandboxId);
      res.end();
    });
  });

  /**
   * GET /api/fs/:sandboxId/session?terminalId=main
   * Returns the saved terminal snapshot ({ scrollback, ... }) or null. Used on
   * reconnect to rebuild the visible session (Gap B recovery interface).
   */
  router.get('/:sandboxId/session', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      if (typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }
      const terminalId = (req.query.terminalId as string) || 'main';
      const snapshot = await sessionStore.load(sandboxId, terminalId);
      res.status(200).json(snapshot);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/fs/:sandboxId/session  { terminalId, scrollback }
   * Persists a terminal's scrollback (pooling save: the client posts on an
   * interval + beforeunload, not per keystroke).
   */
  router.post('/:sandboxId/session', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      if (typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }
      const { terminalId, scrollback } = req.body ?? {};
      if (typeof terminalId !== 'string' || typeof scrollback !== 'string') {
        return res.status(400).json({ error: 'terminalId and scrollback are required' });
      }
      // Trust boundary: cap the dump so a client can't fill the disk. xterm keeps
      // 5000 lines of scrollback; ~1MB is a generous ceiling for that.
      if (scrollback.length > 1_000_000) {
        return res.status(413).json({ error: 'scrollback too large' });
      }
      await sessionStore.save(sandboxId, { v: 1, terminalId, ts: Date.now(), scrollback });
      res.status(204).end();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/fs/:sandboxId/delete?path=/workspace/old_folder
   */
  router.delete('/:sandboxId/delete', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const pathToRemove = req.query.path as string;

      if (!sandboxId || typeof sandboxId !== 'string') {
        return res.status(400).json({ error: 'Invalid Sandbox id' });
      }
      if (!pathToRemove || typeof pathToRemove !== 'string') {
        return res.status(400).json({ error: 'Valid path to delete is required' });
      }

      await fsManager.deletePath(sandboxId, pathToRemove);
      res.status(200).json({ message: 'Path deleted successfully' });
    } catch (error: any) {
      console.error(`[VFS Error] Failed to delete path: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
