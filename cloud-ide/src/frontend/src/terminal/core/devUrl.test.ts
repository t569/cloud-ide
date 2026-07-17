// The link-routing rule. Getting this wrong is the "Cannot GET" bug: xterm's default
// WebLinksAddon opened `http://localhost:3000` directly, which points the browser at
// the HOST's port 3000 — the gateway — not at the dev server inside the container. The
// gateway has no route there, so Express answered "Cannot GET /".
import { describe, it, expect } from 'vitest';
import {
  isLocalDevUrl,
  portOf,
  toPreviewUrl,
  fromPreviewUrl,
  prettyToLocalhostUrl,
  isExternalWebUrl,
} from './devUrl';

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

describe('fromPreviewUrl', () => {
  it('recovers the pretty container-local form and drops the token', () => {
    expect(fromPreviewUrl('http://sbx-1-8080.localhost:3000/docs?theme=dark&__cide_pt=TOK')).toEqual({
      port: 8080,
      path: '/docs?theme=dark',
      pretty: 'localhost:8080/docs?theme=dark',
    });
  });

  it('reads the port as the trailing -<digits> even when the id has hyphens', () => {
    expect(fromPreviewUrl('http://e72f-4917-3000.localhost:3000/?__cide_pt=T')?.port).toBe(3000);
  });

  it('is the inverse of toPreviewUrl (round-trip)', () => {
    const actual = toPreviewUrl('http://localhost:5173/x?a=1', 'sbx-9', 'http://localhost:3000', 'T')!;
    expect(fromPreviewUrl(actual)?.pretty).toBe('localhost:5173/x?a=1');
  });

  it('returns null for a non-preview host', () => {
    expect(fromPreviewUrl('http://localhost:3000/api')).toBeNull();
  });
});

describe('prettyToLocalhostUrl', () => {
  it.each([
    ['localhost:8000/docs', 5173, 'http://localhost:8000/docs'],
    ['http://localhost:8000/docs', 5173, 'http://localhost:8000/docs'],
    ['127.0.0.1:8000', 5173, 'http://localhost:8000/'],
    [':8000/docs', 5173, 'http://localhost:8000/docs'],
    ['8000/docs', 5173, 'http://localhost:8000/docs'], // bare port
    ['/openapi.json', 8000, 'http://localhost:8000/openapi.json'], // path only ⇒ keep current port
    ['docs', 8000, 'http://localhost:8000/docs'], // bare path
  ])('normalises %s (current %i) → %s', (input, current, expected) => {
    expect(prettyToLocalhostUrl(input, current)).toBe(expected);
  });

  it('returns null for empty input', () => {
    expect(prettyToLocalhostUrl('   ', 8000)).toBeNull();
  });
});

describe('isExternalWebUrl', () => {
  it.each([
    'https://fastapi.tiangolo.com',
    'http://example.com/docs',
  ])('treats %s as external (browse directly)', (u) => {
    expect(isExternalWebUrl(u)).toBe(true);
  });

  it.each([
    'localhost:8000/docs', // no scheme + would-be path/port on the sandbox
    'http://localhost:5173', // localhost = a sandbox port
    'https://sbx-1-8080.localhost:3000/x', // our own preview subdomain
    '/docs', // a bare path
    'github.com/foo', // no explicit scheme ⇒ treated as a sandbox path, not the internet
  ])('does NOT treat %s as external', (u) => {
    expect(isExternalWebUrl(u)).toBe(false);
  });
});
