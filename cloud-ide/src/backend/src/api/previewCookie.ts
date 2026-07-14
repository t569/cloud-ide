// The preview session cookie — its own dependency-free module (like previewHost.ts)
// so it's directly unit-testable, without dragging in http-proxy-middleware (ESM,
// which the test runner can't transform) through PreviewRoutes.

// The subdomain-scoped cookie the preview token is exchanged for. Read on every later
// asset/HMR request in place of the token, which only rides the first URL.
export const PREVIEW_COOKIE = 'cide_preview';

/**
 * Build the Set-Cookie for a preview session, adapted to the transport.
 *
 * The preview runs in an <iframe> the IDE embeds. On `*.localhost` (dev) every label is
 * its own site, so the iframe is CROSS-SITE to the IDE — and SameSite keys on the
 * top-level site, not the iframe's own origin. A `SameSite=Lax` cookie is therefore
 * withheld on the iframe's asset/HMR requests (they 403 while the token-bearing first
 * request 200s), which was exactly the bug. That demands `SameSite=None`, which REQUIRES
 * `Secure`.
 *
 *  - `secure` (HTTPS, or a loopback host — browsers treat localhost as a secure context):
 *    `SameSite=None; Secure` so the cookie rides cross-site requests, plus `Partitioned`
 *    (CHIPS) to survive third-party-cookie deprecation and stay scoped to the IDE's
 *    partition. This is the normal path — dev on localhost and all HTTPS deployments.
 *
 *  - insecure transport (plain HTTP on a real/custom domain): `Secure` would be rejected,
 *    and `SameSite=None` needs it — so neither works. But the ONLY insecure deployment that
 *    can host a `<id>-<port>.<host>` preview subdomain is a real dotted domain, where the
 *    preview shares the IDE's registrable domain and is thus SAME-site. `SameSite=Lax` is
 *    sent on same-site requests and needs no `Secure`, so it works — the one case the
 *    None+Secure form couldn't cover. (Serve over HTTPS for the stricter cross-site cookie.)
 *
 * httpOnly throughout: untrusted dev-server code in the frame can't read it.
 */
export function previewCookie(token: string, secure: boolean): string {
  const base = `${PREVIEW_COOKIE}=${token}; Path=/; HttpOnly`;
  return secure
    ? `${base}; Secure; SameSite=None; Partitioned`
    : `${base}; SameSite=Lax`;
}

/**
 * Is the gateway request on a secure transport — HTTPS (directly or via a terminating
 * proxy), or a loopback host, which browsers treat as a secure context and so accept
 * `Secure` cookies over plain HTTP? Decides which cookie form previewCookie can use.
 * Takes primitives (not a req) so it stays pure and unit-testable.
 */
export function isSecureContext(opts: {
  xForwardedProto?: string | string[];
  encrypted?: boolean;
  host?: string;
}): boolean {
  const xfpRaw = Array.isArray(opts.xForwardedProto) ? opts.xForwardedProto[0] : opts.xForwardedProto;
  const xfp = (xfpRaw ?? '').split(',')[0].trim().toLowerCase();
  if (xfp) return xfp === 'https'; // a proxy told us the client-facing scheme
  if (opts.encrypted) return true; // direct TLS socket
  const host = (opts.host ?? '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}
