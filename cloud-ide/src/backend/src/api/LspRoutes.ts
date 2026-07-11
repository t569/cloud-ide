// backend/src/api/LspRoutes.ts
//
// The browser-facing half of the online-LSP path. Pure transport: it owns no
// protocol logic, just shuttles between HttpLSPTransport (frontend) and LspProxy
// (which owns the tunnel to the language server). Sandbox-scoped and IDOR-guarded
// exactly like the /api/fs routes — the session cookie proves ownership.
//
//   POST /api/lsp/:sandboxId/:languageId/:method   body = port params -> JSON result
//   POST /api/lsp/:sandboxId/:languageId/sync       body = { path, changes[] } -> 204
//   GET  /api/lsp/:sandboxId/:languageId/diagnostics -> SSE { path, diagnostics }
import { Router, Request, Response, NextFunction } from 'express';
import { LspProxy, NoLanguageServerError } from '../services/lsp/LspProxy';
import { ISandboxRepository } from '../database/interfaces';
import { requireSandboxOwnership } from './middleware/security';

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function createLspRouter(proxy: LspProxy, sandboxRepo: ISandboxRepository): Router {
  const router = Router();

  router.param('sandboxId', (_req: Request, res: Response, next: NextFunction, id: string) => {
    if (!id || !SAFE_ID.test(id)) return res.status(400).json({ error: 'Invalid sandboxId' });
    next();
  });
  router.param('languageId', (_req: Request, res: Response, next: NextFunction, id: string) => {
    if (!id || !SAFE_ID.test(id)) return res.status(400).json({ error: 'Invalid languageId' });
    next();
  });

  // IDOR: caller must own the sandbox (same guard the file routes use).
  router.use('/:sandboxId', requireSandboxOwnership(sandboxRepo));

  // Diagnostics stream. GET, so it never collides with the POST routes below.
  router.get('/:sandboxId/:languageId/diagnostics', async (req: Request, res: Response) => {
    const { sandboxId, languageId } = req.params as Record<string, string>;

    // No server for this language → 503 so the client's EventSource errors and
    // the status bar shows `offline` (Monaco highlighting carries on).
    if (!proxy.isConfigured(languageId)) return res.status(503).end();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');

    let unsubscribe = () => {};
    try {
      unsubscribe = await proxy.subscribeDiagnostics(sandboxId, languageId, (path, diagnostics) => {
        res.write(`data: ${JSON.stringify({ path, diagnostics })}\n\n`);
      });
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? 'lsp unavailable' })}\n\n`);
    }

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  // didChange: keep the server on the live editor buffer (the hybrid). `changes`
  // are LSP incremental deltas (or a single full-replacement snapshot).
  router.post('/:sandboxId/:languageId/sync', async (req: Request, res: Response) => {
    const { sandboxId, languageId } = req.params as Record<string, string>;
    const { path, changes } = req.body ?? {};
    if (typeof path !== 'string' || !Array.isArray(changes)) {
      return res.status(400).json({ error: 'path and changes[] are required' });
    }
    try {
      await proxy.change(sandboxId, languageId, path, changes);
      res.status(204).end();
    } catch (err: any) {
      if (err instanceof NoLanguageServerError) return res.status(503).end();
      res.status(500).json({ error: err?.message ?? 'sync failed' });
    }
  });

  // A language request (completion/hover/definition/…).
  router.post('/:sandboxId/:languageId/:method', async (req: Request, res: Response) => {
    const { sandboxId, languageId, method } = req.params as Record<string, string>;
    try {
      const result = await proxy.request(sandboxId, languageId, method, req.body ?? {});
      res.status(200).json(result);
    } catch (err: any) {
      if (err instanceof NoLanguageServerError) return res.status(503).end();
      // Unknown method or a server error — the frontend degrades gracefully, so a
      // plain 400/500 is enough (it returns the empty fallback either way).
      res.status(/Unsupported LSP method/.test(err?.message) ? 400 : 500)
        .json({ error: err?.message ?? 'lsp request failed' });
    }
  });

  return router;
}
