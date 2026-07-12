// The ingress URL grammar: `/preview/<sandboxId>/<port>/...`
//
// Its own module, with NO dependencies, because it is parsed in two places that must
// never drift apart — the HTTP proxy's router() and the WebSocket upgrade handler —
// and because that makes it directly unit-testable (PreviewRoutes itself imports the
// ESM-only http-proxy-middleware, which a test can't pull in).
const PREVIEW_PATH = /^\/preview\/([a-zA-Z0-9_-]+)\/(\d{2,5})(?:\/|$)/;

export interface PreviewTarget {
  sandboxId: string;
  port: number;
}

/** Which sandbox + port does this ingress path address? null if it isn't one. */
export function parsePreviewTarget(pathname: string): PreviewTarget | null {
  const match = PREVIEW_PATH.exec(pathname);
  if (!match) return null;
  return { sandboxId: match[1], port: Number(match[2]) };
}

/** Does this upgrade belong to the preview ingress? (Used by the server's dispatcher.) */
export function isPreviewUpgrade(pathname: string): boolean {
  return PREVIEW_PATH.test(pathname);
}

/**
 * Drop the `/preview/<id>/<port>` mount prefix, keeping the rest of the URL (query
 * string included). The dev server inside the sandbox knows nothing about our ingress
 * and must be asked for `/@vite/client`, not `/preview/sbx-1/5173/@vite/client`.
 *
 * The HTTP path gets this for free — Express strips a `router.use(path)` prefix off
 * req.url before the proxy sees it. A WebSocket upgrade never goes through Express, so
 * its req.url still carries the full path and we have to strip it ourselves.
 */
export function stripPreviewPrefix(url: string): string {
  const stripped = url.replace(/^\/preview\/[a-zA-Z0-9_-]+\/\d{2,5}/, '');
  if (!stripped) return '/';
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}
