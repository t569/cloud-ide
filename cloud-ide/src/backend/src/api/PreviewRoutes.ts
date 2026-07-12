// backend/src/api/PreviewRoutes.ts
//
// The Ingress Router (Step 3): exposes HTTP services running inside a sandbox
// (e.g. a Vite dev server on :3000) to the browser via the Gateway.
//
//   GET /preview/:sandboxId/:port/*  ->  {daemon-resolved endpoint for :port}/*
//   WS  /preview/:sandboxId/:port/*  ->  the same, upgraded (dev-server hot reload)
//
// ponytail: path-based routing instead of wildcard subdomains (*.cloudide.com).
// Same proxy core; switch to a `router` keyed on req.headers.host once real DNS exists.
import type http from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { Router, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { ISandboxRepository } from '../database/interfaces';
import { requireSandboxOwnership, userOwnsSandbox } from './middleware/security';
import { readUserId } from './middleware/auth';
import { config } from '../config/env';
import { parsePreviewTarget, stripPreviewPrefix } from './previewPath';

export interface PreviewIngress {
  router: Router;
  /** Handles a WebSocket upgrade on a /preview path. Wired in server.ts. */
  upgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export function createPreviewIngress(
  sandboxManager: SandboxManager,
  sandboxRepo: ISandboxRepository,
): PreviewIngress {
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
   * Wake-on-Demand (3c): if the target sandbox is PAUSED (frozen by the IdleSweeper),
   * thaw it before letting the proxy touch it. Shared by the HTTP and WS paths — a
   * hot-reload socket reconnecting to a sandbox that has since been frozen must wake
   * it too, or the socket dies and the preview goes permanently stale.
   */
  const wake = async (sandboxId: string): Promise<void> => {
    const status = await sandboxManager.getStatus(sandboxId);
    if (status.state === 'PAUSED') {
      console.log(`[Ingress] Auto-resuming sleeping sandbox: ${sandboxId}`);
      await sandboxManager.resume(sandboxId);
      // Same thaw grace period the exec path uses before routing traffic
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  const wakeOnDemand = async (req: Request, res: Response, next: NextFunction) => {
    const { sandboxId } = req.params as { sandboxId: string };
    try {
      await wake(sandboxId);
      next();
    } catch {
      res.status(404).json({ error: `Sandbox ${sandboxId} not found.` });
    }
  };

  /**
   * The preview EXISTS to be embedded in the editor's <iframe>. The global
   * `securityHeaders` middleware sets `X-Frame-Options: DENY` on every response, which
   * makes the browser refuse to render it — the preview pane just sits there blank, and
   * the "exposed port" appears not to work at all.
   *
   * X-Frame-Options cannot express "only my app may frame this" (ALLOW-FROM is dead,
   * and SAMEORIGIN fails here — the SPA on :5173 is a different origin from the gateway
   * on :3000). So drop it for this route and state the policy in CSP, which can name an
   * origin. This NARROWS nothing: DENY was never protecting anything here, it was just
   * breaking the feature.
   */
  const framableByOurAppOnly = (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', `frame-ancestors ${config.FRONTEND_ORIGIN}`);
    next();
  };

  /**
   * One proxy instance for all sandboxes (3a/3b). The `router` callback asks the
   * daemon per-request for a host-routable endpoint for that port — sandboxes have no
   * IP we can reach directly. Resolution fails until something is actually listening
   * on `port` inside the container, which surfaces below as a 502.
   *
   * WebSockets are carried by the `upgrade` handler below calling `proxy.upgrade()`.
   *
   * NOT by `ws: true` — that looks like the obvious switch and is a trap. It makes the
   * library subscribe its OWN `server.on('upgrade')` listener on the first request,
   * and that listener has no pathFilter, so it would proxy EVERY upgrade the gateway
   * receives — the PTY terminal socket included — into this preview proxy, with none
   * of the origin/ownership checks below. It would also silently turn our explicit
   * `proxy.upgrade()` call into a no-op (it skips servers it has already subscribed).
   *
   * The target is parsed from the URL rather than `req.params`, because an upgrade is
   * a raw IncomingMessage that never went through Express and so has no params. For an
   * HTTP request Express has already stripped the mount prefix off `req.url`, so we
   * read `originalUrl` — one grammar, both paths.
   */
  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1', // never used: router() below always overrides
    changeOrigin: true,
    router: async (req) => {
      const pathname = (req as Request).originalUrl ?? req.url ?? '';
      const target = parsePreviewTarget(pathname);
      if (!target) throw new Error(`Not a preview path: ${pathname}`);
      return sandboxManager.resolveEndpoint(target.sandboxId, target.port);
    },
    on: {
      // The proxied app can also refuse to be framed — a dev server that sends its own
      // X-Frame-Options, or a CSP carrying frame-ancestors, would block the preview
      // exactly as our own DENY did. Those headers are copied onto our response
      // verbatim, so strip the framing directives on the way back and let the policy set
      // above stand. Only framing is touched; any other CSP the app sends is left alone.
      proxyRes: (proxyRes) => {
        delete proxyRes.headers['x-frame-options'];
        const csp = proxyRes.headers['content-security-policy'];
        if (typeof csp === 'string' && /frame-ancestors/i.test(csp)) {
          const stripped = csp
            .split(';')
            .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
            .join(';')
            .trim();
          if (stripped) proxyRes.headers['content-security-policy'] = stripped;
          else delete proxyRes.headers['content-security-policy'];
        }
      },
      error: (err, _req, res) => {
        console.error(`[Ingress] Proxy error: ${err.message}`);
        const response = res as Response;
        // On a WS upgrade `res` is a raw socket, which has no status()/headersSent.
        if (typeof response?.status !== 'function') {
          (res as unknown as Duplex)?.destroy?.();
          return;
        }
        if (!response.headersSent) {
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
  router.use(
    '/:sandboxId/:port',
    validateParams,
    requireSandboxOwnership(sandboxRepo),
    framableByOurAppOnly,
    wakeOnDemand,
    proxy,
  );

  /**
   * The WebSocket half. An upgrade bypasses Express entirely, so every guard the HTTP
   * chain applies has to be re-applied here BY HAND — the middleware above does not
   * run for it. Order mirrors the router: parse, origin, ownership, wake, then proxy.
   */
  const upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    const target = parsePreviewTarget(pathname);
    if (!target) {
      socket.destroy();
      return;
    }

    // Cross-Site WebSocket Hijacking: an upgrade handshake is NOT covered by CORS and
    // carries cookies, so any origin could otherwise open a socket into a logged-in
    // user's dev server. Two origins are legitimate here: our SPA, and the previewed
    // page itself — it is served from THIS origin (inside the iframe at
    // /preview/...), so its hot-reload socket presents the gateway's own origin.
    const origin = req.headers.origin;
    const allowed = [config.FRONTEND_ORIGIN, config.PUBLIC_API_URL];
    if (origin && !allowed.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // readUserId, not currentUser: an upgrade has no Response to set a cookie on, and
    // a caller with no identity must be refused, not handed a fresh one.
    void userOwnsSandbox(sandboxRepo, readUserId(req.headers.cookie), target.sandboxId)
      .then(async (owns) => {
        if (!owns) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
        await wake(target.sandboxId);

        // Express strips the mount prefix for HTTP; nothing did it for this upgrade.
        // The dev server must be asked for /@vite/client, not /preview/<id>/<port>/@vite/client.
        //
        // Preserve the full path on `originalUrl` exactly as Express would — router()
        // above reads it to work out which sandbox/port to resolve, and it must still
        // see the un-stripped URL after this rewrite.
        (req as { originalUrl?: string }).originalUrl = req.url;
        req.url = stripPreviewPrefix(req.url ?? '');

        // `upgrade` types the socket as Duplex; it is always a net.Socket at runtime,
        // which is what http-proxy-middleware's signature wants.
        proxy.upgrade!(req, socket as Socket, head);
      })
      .catch(() => socket.destroy());
  };

  return { router, upgrade };
}
