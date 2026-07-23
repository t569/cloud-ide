// backend/src/api/GitProxyRoutes.ts
//
// A CORS shim for the BROWSER tier's git traffic. Git hosts send no
// Access-Control-Allow-Origin, so a page cannot speak smart-HTTP to github.com directly;
// isomorphic-git therefore routes every request through a proxy that adds the headers.
//
// ⚠️ This endpoint takes a URL from the caller and fetches it, forwarding the caller's
// Authorization header. That is an SSRF primitive and a credential-forwarding primitive in
// one, so it is deliberately NOT a general proxy:
//
//   - HOST ALLOW-LIST. Only known git hosts, matched on the exact hostname (or a
//     subdomain of one), so `github.com.evil.tld` and `evil.tld?x=github.com` both fail.
//   - PATH ALLOW-LIST. Only the three smart-HTTP endpoints. Nothing else is reachable,
//     so it cannot be used to read a repo's web UI or any other API.
//   - https ONLY, and REDIRECTS ARE NOT FOLLOWED — a 302 to another host would otherwise
//     carry the Authorization header somewhere the allow-list never approved.
//
// Without those, an authenticated user could point this at an internal address and read
// the response, which on a cloud host means the metadata service.

import { Router, Request, Response } from 'express';

/** Hosts a browser workspace may reach. Exact match, or a subdomain of one. */
const ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];

/** The entire smart-HTTP surface: ref discovery, fetch, push. */
const ALLOWED_PATHS = [/\/info\/refs$/, /\/git-upload-pack$/, /\/git-receive-pack$/];

/** Headers worth passing through in each direction. Everything else is dropped. */
const FORWARD_TO_GIT = ['authorization', 'content-type', 'accept', 'git-protocol', 'user-agent'];
const FORWARD_TO_CLIENT = ['content-type', 'cache-control', 'expires', 'pragma'];

export function isAllowedGitUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // `endsWith('.' + host)` and not `includes(host)` — the latter accepts evil-github.com.
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname));
}

/**
 * Mounted at /api/git-proxy. isomorphic-git appends the target to the proxy base, so a
 * request arrives as `/api/git-proxy/github.com/owner/repo/info/refs?service=…`.
 */
export function createGitProxyRouter(): Router {
  const router = Router();

  router.all('/*splat', async (req: Request, res: Response) => {
    const target = `https:/${req.url}`; // req.url keeps its leading slash
    if (!isAllowedGitUrl(target)) {
      res.status(403).json({ error: 'This proxy only forwards git smart-HTTP to known git hosts.' });
      return;
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARD_TO_GIT) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        // GET/HEAD must not carry one; express.raw gives a Buffer for the POST bodies.
        // Buffer → Uint8Array: fetch's BodyInit accepts the latter, and Buffer's generic
        // ArrayBufferLike parameter does not satisfy it under this lib config.
        body:
          req.method === 'GET' || req.method === 'HEAD'
            ? undefined
            : new Uint8Array(req.body as Buffer),
        redirect: 'manual', // never follow — a cross-host 302 would leak Authorization
      });

      res.status(upstream.status);
      for (const name of FORWARD_TO_CLIENT) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err: any) {
      res.status(502).json({ error: `Git host unreachable: ${err?.message ?? err}` });
    }
  });

  return router;
}
