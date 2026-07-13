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
import { SandboxEndpoint } from '../types/engine';
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
   * The endpoint resolved for THIS request, stashed on it.
   *
   * Both halves of the proxy need it and they are reached separately: `router()` asks
   * "which target?", `proxyReq` asks "which headers?". Resolving in each would mean two
   * round-trips to the daemon per proxied asset. And on a WebSocket upgrade there is no
   * Express pipeline at all, so the upgrade handler fills this in by hand.
   */
  type WithEndpoint = { previewEndpoint?: SandboxEndpoint };

  /**
   * Ask the provider how to reach the user's service, before any byte is proxied.
   *
   * This resolves a ROUTE, and says nothing about whether anything is listening on the
   * far end — the daemon builds its proxy URL without probing the port. So a dev server
   * that hasn't started yet does not fail here; it fails when the daemon tries to
   * connect, and surfaces as its own 502 ("Could not connect to the backend sandbox").
   * This only fires when there is no route at all: an unknown sandbox, a dead container.
   */
  const resolveTarget = async (req: Request, res: Response, next: NextFunction) => {
    const { sandboxId, port } = req.params as { sandboxId: string; port: string };
    try {
      (req as WithEndpoint).previewEndpoint = await sandboxManager.resolveEndpoint(
        sandboxId,
        Number(port),
      );
      next();
    } catch (err) {
      res.status(502).json({
        error: `Could not resolve a route to port ${port} in this sandbox.`,
        details: (err as Error).message,
      });
    }
  };

  /**
   * One proxy instance for all sandboxes (3a/3b). The target is whatever `resolveTarget`
   * put on the request — the provider's own proxy route into the container, since
   * sandboxes have no IP we can reach directly.
   *
   * WebSockets are carried by the `upgrade` handler below calling `proxy.upgrade()`.
   *
   * NOT by `ws: true` — that looks like the obvious switch and is a trap. It makes the
   * library subscribe its OWN `server.on('upgrade')` listener on the first request,
   * and that listener has no pathFilter, so it would proxy EVERY upgrade the gateway
   * receives — the PTY terminal socket included — into this preview proxy, with none
   * of the origin/ownership checks below. It would also silently turn our explicit
   * `proxy.upgrade()` call into a no-op (it skips servers it has already subscribed).
   */
  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1', // never used: router() below always overrides
    changeOrigin: true,
    // The endpoint URL carries a path of its own (`/sandboxes/<id>/proxy/<port>`), and
    // the request's path must hang off it — `/assets/app.js` has to arrive as
    // `/sandboxes/<id>/proxy/<port>/assets/app.js`. This is http-proxy's default, stated
    // explicitly because the whole ingress silently serves 404s if it ever flips.
    prependPath: true,
    router: (req) => {
      const endpoint = (req as WithEndpoint).previewEndpoint;
      // Unreachable via the router below (resolveTarget runs first and 502s on failure);
      // a loud throw beats proxying to the placeholder target if that ever changes.
      if (!endpoint) throw new Error('Preview endpoint was not resolved for this request.');
      return endpoint.url;
    },
    on: {
      /**
       * The provider's endpoint can REQUIRE headers — the OpenSandbox daemon guards the
       * proxy route with its API key, exactly like every other route it serves. Without
       * this the preview works only in a keyless local dev setup and 401s everywhere else.
       */
      proxyReq: (proxyReq, req) => {
        const endpoint = (req as WithEndpoint).previewEndpoint;
        if (!endpoint) return;
        for (const [name, value] of Object.entries(endpoint.headers)) {
          proxyReq.setHeader(name, value);
        }
      },
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
    resolveTarget, // after wake: a paused container has nothing listening to resolve
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

        // No Express pipeline here, so resolveTarget never ran: do its job by hand.
        // Both the target and its required headers have to be in place before the
        // upgrade goes out — a socket cannot be re-authenticated after the handshake.
        const endpoint = await sandboxManager.resolveEndpoint(target.sandboxId, target.port);
        (req as WithEndpoint).previewEndpoint = endpoint;
        for (const [name, value] of Object.entries(endpoint.headers)) {
          req.headers[name.toLowerCase()] = value; // node normalizes header names to lower case
        }

        // THE INGRESS TERMINATES THE ORIGIN CHECK. It does NOT relay it.
        //
        // A modern dev server rejects a cross-origin WebSocket outright: Vite answers
        // the HMR handshake with 400 for ANY Origin it does not recognise (measured —
        // it even refuses its own container-IP origin; only a request with no Origin at
        // all is accepted). The browser's Origin here is always the gateway, so
        // forwarding it verbatim means hot reload can never connect, no matter what the
        // user puts in vite.config.
        //
        // That rejection is CORRECT for a dev server exposed straight to a browser, and
        // meaningless for one reached through us: we are a server-side proxy, not a web
        // page. The check that actually defends this socket already ran above — the
        // Origin allow-list and the sandbox ownership guard — and it ran against the
        // REAL browser origin, which is the only place it can be enforced honestly.
        // Passing it on merely tells the dev server a lie it is right to hang up on.
        //
        // So: validate the origin, then speak first-party, exactly as we already do with
        // cookies and CSRF. This is what makes HMR work with no user config at all.
        delete req.headers.origin;

        // Express strips the mount prefix for HTTP; nothing did it for this upgrade.
        // The dev server must be asked for /@vite/client, not /preview/<id>/<port>/@vite/client.
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
