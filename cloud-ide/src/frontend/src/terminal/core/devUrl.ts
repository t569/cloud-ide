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
 * Rewrite a container-local dev URL onto the gateway's ingress, preserving the path
 * and query so a deep link still lands where it was pointing.
 *
 *   http://localhost:5173/docs?x=1  ->  <origin>/preview/<sandboxId>/5173/docs?x=1
 *
 * `gatewayOrigin` is the API base with its /api suffix removed — the ingress router is
 * mounted at the server root, not under /api.
 */
export function toIngressUrl(rawUrl: string, sandboxId: string, gatewayOrigin: string): string | null {
  const port = portOf(rawUrl);
  if (port === null) return null;

  // Everything after the host: path + query + hash. Absent => the root.
  const suffix = rawUrl.replace(/^https?:\/\/[^/]+/i, '') || '/';
  const base = `${gatewayOrigin}/preview/${encodeURIComponent(sandboxId)}/${port}`;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}
