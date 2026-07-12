// The link-routing rule. Getting this wrong is the "Cannot GET" bug: xterm's default
// WebLinksAddon opened `http://localhost:3000` directly, which points the browser at
// the HOST's port 3000 — the gateway — not at the dev server inside the container. The
// gateway has no route there, so Express answered "Cannot GET /".
import { describe, it, expect } from 'vitest';
import { isLocalDevUrl, portOf, toIngressUrl } from './devUrl';

describe('isLocalDevUrl', () => {
  it.each([
    'http://localhost:3000',
    'http://localhost:5173/',
    'http://127.0.0.1:8080/docs',
    'https://localhost:443',
    'http://0.0.0.0:3000', // what a server bound to all interfaces prints
  ])('claims %s — it lives inside the container and must be proxied', (url) => {
    expect(isLocalDevUrl(url)).toBe(true);
  });

  it.each([
    'https://vitejs.dev/guide/',
    'https://github.com/foo/bar',
    'http://localhost.evil.com/', // NOT localhost: the host is localhost.evil.com
  ])('leaves %s alone — a real external link should open in a tab', (url) => {
    expect(isLocalDevUrl(url)).toBe(false);
  });
});

describe('portOf', () => {
  it('reads an explicit port', () => {
    expect(portOf('http://localhost:5173/x')).toBe(5173);
  });

  it('falls back to the scheme default rather than giving up', () => {
    expect(portOf('http://localhost/')).toBe(80);
    expect(portOf('https://localhost/')).toBe(443);
  });
});

describe('toIngressUrl', () => {
  const origin = 'http://localhost:3000';

  it('rewrites a bare dev-server URL onto the ingress', () => {
    expect(toIngressUrl('http://localhost:5173', 'sbx-1', origin)).toBe(
      'http://localhost:3000/preview/sbx-1/5173/',
    );
  });

  it('preserves the path and query, so a deep link still lands where it pointed', () => {
    expect(toIngressUrl('http://127.0.0.1:8080/docs/intro?theme=dark', 'sbx-1', origin)).toBe(
      'http://localhost:3000/preview/sbx-1/8080/docs/intro?theme=dark',
    );
  });

  it('keeps the sandbox id safe for a URL', () => {
    expect(toIngressUrl('http://localhost:3000/', 'sbx/../etc', origin)).toContain(
      '/preview/sbx%2F..%2Fetc/3000/',
    );
  });
});
