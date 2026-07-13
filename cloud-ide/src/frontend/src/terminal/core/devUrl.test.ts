// The link-routing rule. Getting this wrong is the "Cannot GET" bug: xterm's default
// WebLinksAddon opened `http://localhost:3000` directly, which points the browser at
// the HOST's port 3000 — the gateway — not at the dev server inside the container. The
// gateway has no route there, so Express answered "Cannot GET /".
import { describe, it, expect } from 'vitest';
import { isLocalDevUrl, portOf, toPreviewUrl } from './devUrl';

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

describe('toPreviewUrl', () => {
  const origin = 'http://localhost:3000';

  it('rewrites a bare dev-server URL onto its subdomain, with the token', () => {
    expect(toPreviewUrl('http://localhost:5173', 'sbx-1', origin, 'TOK')).toBe(
      'http://sbx-1-5173.localhost:3000/?__cide_pt=TOK',
    );
  });

  it('preserves the path and appends the token with & when a query already exists', () => {
    expect(toPreviewUrl('http://127.0.0.1:8080/docs/intro?theme=dark', 'sbx-1', origin, 'TOK')).toBe(
      'http://sbx-1-8080.localhost:3000/docs/intro?theme=dark&__cide_pt=TOK',
    );
  });

  it('puts the sandbox id and port in the hostname so absolute asset paths resolve', () => {
    // The whole point: /static/js/bundle.js off THIS origin hits the dev server, not the gateway.
    const url = toPreviewUrl('http://localhost:3000/', 'e72f-4917', origin, 'TOK');
    expect(url).toContain('e72f-4917-3000.localhost:3000/');
  });

  it('carries https through to the subdomain scheme', () => {
    expect(toPreviewUrl('http://localhost:5173/', 'sbx', 'https://ide.example.com', 'T')).toBe(
      'https://sbx-5173.ide.example.com/?__cide_pt=T',
    );
  });
});
