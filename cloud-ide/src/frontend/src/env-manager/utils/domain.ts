/**
 * Normalize a user-typed egress domain to a bare host or wildcard.
 *
 * People paste all sorts of things ("https://API.Example.com/webhooks"); the allow-list
 * wants a host or wildcard ("api.example.com", "*.example.com"). So: trim, lowercase,
 * drop any scheme, drop any path. Returns '' for empty/whitespace input — the caller
 * treats that as "nothing to add".
 */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}
