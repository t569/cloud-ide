// backend/src/api/PreviewRoutes.ts
//
// The Ingress: exposes an HTTP service running inside a sandbox (a dev server on 5173,
// an API on 8000) to the browser, as a SUBDOMAIN of the gateway:
//
//   http(s)://<sandboxId>-<port>.<gateway-host>/...   ->   {daemon proxy for that port}/...
//
// Why a subdomain and not `/preview/<id>/<port>/...`: a real dev server emits ROOT-ABSOLUTE
// URLs (`/static/js/bundle.js`, `ws://<origin>/ws`). Under a path prefix those escape it and
// hit the gateway root — the "Refused to execute script … MIME type text/html" bug, and the
// reason HMR could never connect. As a subdomain the app owns its own origin root: nothing
// to strip, nothing to rewrite, and HMR "just works" for any framework.
//
// AUTH: the subdomain is a different origin, so the `uid` session cookie is NOT sent to it.
// The SPA mints a signed preview token (owner-gated, see SandboxController.getPreviewToken)
// and puts it in the first URL (`?__cide_pt=`). The ingress exchanges it for a cookie scoped
// to THIS subdomain, so every later asset/HMR request is authorized without the token.
import type http from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { RequestHandler, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { SandboxEndpoint } from '../types/engine';
import { ISandboxRepository } from '../database/interfaces';
import { parseCookies } from './middleware/security';
import { verifyPreviewToken } from './middleware/auth';
import { config } from '../config/env';
import { parsePreviewHost, PreviewTarget } from './previewHost';
import { PREVIEW_COOKIE, previewCookie, isSecureContext } from './previewCookie';

export interface PreviewIngress {
  /** App-wide middleware: handles preview-subdomain hosts, passes everything else through. */
  middleware: RequestHandler;
  /** Handles a WebSocket upgrade on a preview subdomain (HMR). Wired in server.ts. */
  upgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
}

// The subdomain-scoped cookie the token is exchanged for. httpOnly (a dev server running
// untrusted code can't read it) and host-only (set without Domain), so it authorizes only
// THIS `<id>-<port>.<host>` subdomain and nothing else.
const TOKEN_PARAM = '__cide_pt';

export function createPreviewIngress(
  sandboxManager: SandboxManager,
  sandboxRepo: ISandboxRepository,
): PreviewIngress {
  // The endpoint resolved for THIS request, stashed on it (both proxy halves read it).
  type WithEndpoint = { previewEndpoint?: SandboxEndpoint };

  /**
   * Authorize a preview request for `target`. Two ways in:
   *  - a valid `cide_preview` cookie for this sandbox (the steady state), or
   *  - a valid `?__cide_pt` token in the URL (the first hit) — which we exchange for the
   *    cookie and strip from the URL so the dev server never sees it.
   * Returns false (→ 403) if neither proves ownership of this sandbox.
   */
  const authorize = (target: PreviewTarget, req: http.IncomingMessage, res?: Response): boolean => {
    const cookies = parseCookies(req.headers.cookie);
    if (verifyPreviewToken(cookies[PREVIEW_COOKIE], target.sandboxId)) return true;

    const url = new URL(req.url ?? '/', 'http://preview.local');
    const token = url.searchParams.get(TOKEN_PARAM) ?? undefined;
    if (!token || !verifyPreviewToken(token, target.sandboxId)) return false;

    if (res) {
      // Cross-site because the preview is framed by the IDE; cookie form depends on the
      // transport (Secure needs HTTPS/localhost) — see previewCookie.
      const secure = isSecureContext({
        xForwardedProto: req.headers['x-forwarded-proto'],
        encrypted: (req.socket as { encrypted?: boolean } | undefined)?.encrypted,
        host: req.headers.host,
      });
      res.setHeader('Set-Cookie', previewCookie(token, secure));
    }
    // Hide the token from the proxied app.
    url.searchParams.delete(TOKEN_PARAM);
    req.url = url.pathname + (url.search === '?' || url.search === '' ? '' : url.search);
    return true;
  };

  /** Wake a PAUSED sandbox before routing traffic (same wake-on-demand as exec). */
  const wake = async (sandboxId: string): Promise<void> => {
    const status = await sandboxManager.getStatus(sandboxId);
    if (status.state === 'PAUSED') {
      await sandboxManager.resume(sandboxId);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1', // never used: router() overrides per request
    changeOrigin: true,
    // The endpoint URL carries the daemon's proxy path (`/sandboxes/<id>/proxy/<port>`);
    // the request's own path hangs off it. Default, stated because the whole ingress
    // silently 404s if it flips.
    prependPath: true,
    router: (req) => {
      const endpoint = (req as WithEndpoint).previewEndpoint;
      if (!endpoint) throw new Error('Preview endpoint was not resolved for this request.');
      return endpoint.url;
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // The daemon guards its proxy route with an API key; carry whatever headers the
        // endpoint requires (see SandboxEndpoint) or a keyed deployment 401s.
        const endpoint = (req as WithEndpoint).previewEndpoint;
        for (const [name, value] of Object.entries(endpoint?.headers ?? {})) {
          proxyReq.setHeader(name, value);
        }
      },
      proxyRes: (proxyRes) => {
        // The app may send its own framing directives that would block the preview iframe
        // exactly as our own DENY did. Strip only the framing bits; leave any other CSP.
        delete proxyRes.headers['x-frame-options'];
        const csp = proxyRes.headers['content-security-policy'];
        if (typeof csp === 'string' && /frame-ancestors/i.test(csp)) {
          const stripped = csp
            .split(';')
            .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
            .join(';')
            .trim();
          if (stripped) proxyRes.headers['content-security-policy'] = stripped;
          else delete proxyRes.headers['content-security-policy'];
        }
        // Let our app frame it; nobody else.
        proxyRes.headers['content-security-policy'] =
          [proxyRes.headers['content-security-policy'], `frame-ancestors ${config.FRONTEND_ORIGIN}`]
            .filter(Boolean)
            .join('; ');
      },
      error: (err, _req, res) => {
        console.error(`[Ingress] Proxy error: ${err.message}`);
        const response = res as Response;
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

  const middleware: RequestHandler = (req, res, next) => {
    const target = parsePreviewHost(req.headers.host);
    if (!target) return next(); // not a preview subdomain — normal gateway routing

    void handle(target, req, res);
  };

  async function handle(target: PreviewTarget, req: Request, res: Response): Promise<void> {
    if (!authorize(target, req, res)) {
      res.status(403).json({ error: 'Preview access denied. Open the preview from the app.' });
      return;
    }
    // Remove our own X-Frame-Options (securityHeaders never ran for this host, but a
    // belt-and-braces removal keeps the iframe framable if the mount order changes).
    res.removeHeader('X-Frame-Options');

    try {
      await wake(target.sandboxId);
    } catch {
      res.status(404).json({ error: `Sandbox ${target.sandboxId} not found.` });
      return;
    }
    try {
      (req as WithEndpoint).previewEndpoint = await sandboxManager.resolveEndpoint(
        target.sandboxId,
        target.port,
      );
    } catch (err) {
      res.status(502).json({
        error: `Could not resolve a route to port ${target.port} in this sandbox.`,
        details: (err as Error).message,
      });
      return;
    }
    proxy(req, res, (err?: unknown) => {
      if (err && !res.headersSent) res.status(502).json({ error: String(err) });
    });
  }

  /**
   * The WebSocket half (HMR). An upgrade bypasses Express, so auth is re-applied by hand.
   * The socket is initiated from the iframe's own (subdomain) origin, so it carries the
   * `cide_preview` cookie (SameSite=None; see previewCookie — needed because the iframe is
   * cross-site to the IDE). Forgery is blocked by the token's HMAC signature, not SameSite:
   * the cookie is httpOnly and host-only, and its value is a signature bound to this sandbox.
   */
  const upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const target = parsePreviewHost(req.headers.host);
    if (!target) {
      socket.destroy();
      return;
    }
    if (!authorize(target, req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    void wake(target.sandboxId)
      .then(async () => {
        const endpoint = await sandboxManager.resolveEndpoint(target.sandboxId, target.port);
        (req as WithEndpoint).previewEndpoint = endpoint;
        for (const [name, value] of Object.entries(endpoint.headers)) {
          req.headers[name.toLowerCase()] = value;
        }
        // Speak first-party to the dev server: it rejects a cross-origin HMR handshake,
        // and the real browser origin was already validated by the token/cookie above.
        delete req.headers.origin;
        proxy.upgrade!(req, socket as Socket, head);
      })
      .catch(() => socket.destroy());
  };

  return { middleware, upgrade };
}
