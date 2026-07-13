// What counts as "a dev server running inside the sandbox", and how to reach it.
//
// Its own module because THREE places have to agree: the WebLinks handler (a click on
// the underlined URL in the terminal), the LinkSniffer badge, and the workspace that
// builds the ingress URL. Disagreement here is invisible — the link just quietly opens
// the wrong thing.

/**
 * Is this a URL pointing at localhost, i.e. at a port inside the container?
 *
 * These must never be opened directly. The browser would resolve `localhost` against
 * the USER'S machine, not the sandbox — landing on the gateway (or on nothing) rather
 * than on their dev server. `http://localhost:3000` in particular hits the gateway's
 * own port and answers "Cannot GET /", which is the bug this exists to prevent.
 */
export function isLocalDevUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{2,5})?(\/|$)/i.test(url);
}

/** The port a local dev URL is served on, defaulting to the scheme's. */
export function portOf(url: string): number | null {
  const match = /^https?:\/\/[^/:]+:(\d{2,5})/.exec(url);
  if (match) return Number(match[1]);
  if (/^https:/i.test(url)) return 443;
  if (/^http:/i.test(url)) return 80;
  return null;
}

/**
 * Rewrite a container-local dev URL onto the gateway's SUBDOMAIN ingress, preserving the
 * path and query, and appending a one-time preview token:
 *
 *   http://localhost:5173/docs?x=1
 *     ->  http://<sandboxId>-5173.<gatewayHost>/docs?x=1&__cide_pt=<token>
 *
 * Subdomain, not `<origin>/preview/<id>/<port>/`, because a real dev server emits
 * root-absolute asset/HMR URLs that would escape a path prefix (the "MIME type text/html"
 * bug). On its own subdomain the app owns its origin root, so nothing breaks.
 *
 * `gatewayOrigin` is the API base with its `/api` suffix removed (e.g. `http://localhost:3000`);
 * `token` comes from GET /v1/sandboxes/:id/preview-token — the subdomain has no session
 * cookie, so the token is how the ingress authenticates the first request.
 */
export function toPreviewUrl(
  rawUrl: string,
  sandboxId: string,
  gatewayOrigin: string,
  token: string,
): string | null {
  const port = portOf(rawUrl);
  if (port === null) return null;

  const gw = /^(https?):\/\/(.+?)\/?$/i.exec(gatewayOrigin);
  if (!gw) return null;
  const [, scheme, host] = gw; // e.g. 'http', 'localhost:3000'

  // Everything after the host: path + query + hash. Absent => the root.
  const suffix = rawUrl.replace(/^https?:\/\/[^/]+/i, '') || '/';
  const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${scheme}://${sandboxId}-${port}.${host}${path}${sep}__cide_pt=${encodeURIComponent(token)}`;
}
