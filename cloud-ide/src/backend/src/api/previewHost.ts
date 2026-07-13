// The subdomain ingress grammar: `<sandboxId>-<port>.<gateway-host>`.
//
// Its own dependency-free module because it is parsed in two places that must never drift
// (the HTTP host router and the WebSocket upgrade handler) and because that makes it
// directly unit-testable.
//
// Why the sandbox+port live in the HOSTNAME, not a path prefix: a real dev server emits
// ROOT-ABSOLUTE URLs (`/static/js/bundle.js`, `ws://<origin>/ws`). Under `/preview/<id>/
// <port>/` those escape the prefix and hit the gateway root — the "MIME type text/html"
// bug. As a subdomain there is no prefix to escape: the app owns its own origin root.

export interface PreviewTarget {
  sandboxId: string;
  port: number;
}

// The first hostname label is `<sandboxId>-<port>`; everything after the first dot is the
// gateway's own host (`localhost:3000`, `preview.example.com`, …) and is ignored here.
// `[a-z0-9-]+` matches a UUID sandbox id; the trailing `-<digits>` is the port. The regex
// is greedy on the id, so `e72f...88505-3000` splits as id=`e72f...88505`, port=`3000`.
const PREVIEW_LABEL = /^([a-zA-Z0-9-]+)-(\d{2,5})$/;

/**
 * Which sandbox + port does this Host header address? null if it isn't a preview host.
 * Accepts the raw `Host` value (may carry `:port`); only the first label is inspected, so
 * a plain `localhost:3000` or `api.example.com` returns null.
 */
export function parsePreviewHost(host: string | undefined): PreviewTarget | null {
  if (!host) return null;
  const firstLabel = host.split(':')[0].split('.')[0];
  const match = PREVIEW_LABEL.exec(firstLabel);
  if (!match) return null;
  return { sandboxId: match[1], port: Number(match[2]) };
}

/** True when this Host header is a preview subdomain (used by the server's dispatcher). */
export function isPreviewHost(host: string | undefined): boolean {
  return parsePreviewHost(host) !== null;
}

/**
 * Build the preview hostname `<sandboxId>-<port>.<baseHost>` for a gateway reachable at
 * `baseHost` (e.g. `localhost:3000`). The frontend builds its own URLs, but keeping the
 * construction here too lets a test prove parse(build(x)) === x.
 */
export function previewHostFor(sandboxId: string, port: number, baseHost: string): string {
  return `${sandboxId}-${port}.${baseHost}`;
}
