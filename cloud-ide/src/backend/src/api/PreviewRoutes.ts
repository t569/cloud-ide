// backend/src/api/PreviewRoutes.ts
//
// The Ingress Router (Step 3): exposes HTTP services running inside a sandbox
// (e.g. a Vite dev server on :3000) to the browser via the Gateway.
//
//   GET /preview/:sandboxId/:port/*  ->  {daemon-resolved endpoint for :port}/*
//
// ponytail: path-based routing instead of wildcard subdomains (*.cloudide.com).
// Same proxy core; switch to a `router` keyed on req.headers.host once real DNS exists.
import { Router, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { ISandboxRepository } from '../database/interfaces';
import { requireSandboxOwnership } from './middleware/security';

export function createPreviewRouter(
  sandboxManager: SandboxManager,
  sandboxRepo: ISandboxRepository,
): Router {
  const router = Router();

  /** Reject malformed ids/ports before they reach the repository or the proxy. */
  const validateParams = (req: Request, res: Response, next: NextFunction) => {
    const { sandboxId, port } = req.params as { sandboxId: string; port: string };
    if (!/^[a-zA-Z0-9_-]+$/.test(sandboxId) || !/^\d{2,5}$/.test(port)) {
      res.status(400).json({ error: 'Invalid sandboxId or port.' });
      return;
    }
    next();
  };

  /**
   * Wake-on-Demand (3c): if the target sandbox is PAUSED (frozen by the
   * IdleSweeper), thaw it before letting the proxy touch it — mirrors the
   * interception pattern used by the exec stream in SandboxController.
   * Runs only for a verified owner (see the mount below).
   */
  const wakeOnDemand = async (req: Request, res: Response, next: NextFunction) => {
    const { sandboxId } = req.params as { sandboxId: string; port: string };

    try {
      const status = await sandboxManager.getStatus(sandboxId);
      if (status.state === 'PAUSED') {
        console.log(`[Ingress] Auto-resuming sleeping sandbox: ${sandboxId}`);
        await sandboxManager.resume(sandboxId);
        // Same thaw grace period the exec path uses before routing traffic
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      next();
    } catch {
      res.status(404).json({ error: `Sandbox ${sandboxId} not found.` });
    }
  };

  /**
   * One proxy instance for all sandboxes (3a/3b). The `router` callback asks the
   * daemon per-request for a host-routable endpoint for that port — sandboxes have no
   * IP we can reach directly. Resolution fails until something is actually listening
   * on `port` inside the container, which surfaces below as a 502.
   * ponytail: HTTP only — WebSocket upgrade (HMR) needs server.on('upgrade')
   * wiring in server.ts; add when a preview actually needs live reload.
   */
  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1', // never used: router() below always overrides
    changeOrigin: true,
    router: async (req) => {
      const { sandboxId, port } = (req as Request).params as { sandboxId: string; port: string };
      return sandboxManager.resolveEndpoint(sandboxId, Number(port));
    },
    on: {
      error: (err, _req, res) => {
        console.error(`[Ingress] Proxy error: ${err.message}`);
        const response = res as Response;
        if ('headersSent' in response && !response.headersSent) {
          response.status(502).json({ error: `Sandbox service unreachable: ${err.message}` });
        }
      },
    },
  });

  // IDOR: previews were reachable by anyone who knew a sandboxId — they proxy HTTP
  // straight into another user's dev server, and wakeOnDemand would even resume
  // their paused container. Ownership is checked BEFORE wakeOnDemand so an
  // unauthorized caller cannot even cause a resume. Validation runs first so a
  // malformed id 400s rather than hitting the repo.
  router.use('/:sandboxId/:port', validateParams, requireSandboxOwnership(sandboxRepo), wakeOnDemand, proxy);
  return router;
}
