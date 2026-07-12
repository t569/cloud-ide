// The ingress URL grammar. It is parsed in TWO places that must never disagree: the
// HTTP proxy's router() and the WebSocket upgrade handler. A WS upgrade skips Express
// entirely (no req.params), so the only thing keeping hot-reload pointed at the same
// sandbox as the page it belongs to is this one function.
import { parsePreviewTarget, isPreviewUpgrade, stripPreviewPrefix } from './previewPath';

describe('parsePreviewTarget', () => {
  it('pulls the sandbox and port out of an ingress path', () => {
    expect(parsePreviewTarget('/preview/sbx-abc123/5173/')).toEqual({
      sandboxId: 'sbx-abc123',
      port: 5173,
    });
  });

  it('keeps working deep in the app, where a hot-reload socket actually connects', () => {
    // Vite's HMR client opens something like /preview/<id>/<port>/@vite/client — the
    // target has to survive a suffix, or the socket resolves to nothing.
    expect(parsePreviewTarget('/preview/sbx-1/3000/@vite/client')).toEqual({
      sandboxId: 'sbx-1',
      port: 3000,
    });
  });

  it('accepts the bare form with no trailing slash', () => {
    expect(parsePreviewTarget('/preview/sbx-1/8080')).toEqual({ sandboxId: 'sbx-1', port: 8080 });
  });

  it.each([
    ['/preview/sbx-1', 'no port'],
    ['/preview//5173/', 'no sandbox'],
    ['/preview/sbx-1/notaport/', 'non-numeric port'],
    ['/preview/sbx-1/1234567/', 'port too long'],
    ['/api/v1/sandboxes/sbx-1/pty', 'the PTY route, which is a DIFFERENT handler'],
    ['/preview/../etc/passwd', 'path traversal in the sandbox id'],
  ])('rejects %s (%s)', (path) => {
    expect(parsePreviewTarget(path)).toBeNull();
  });
});

describe('isPreviewUpgrade', () => {
  // The upgrade dispatcher in server.ts asks both handlers "is this yours?" and
  // destroys the socket only if NOBODY claims it. If this said yes to the PTY path,
  // two handlers would fight over one socket.
  it('claims preview sockets and disclaims the PTY bridge', () => {
    expect(isPreviewUpgrade('/preview/sbx-1/5173/')).toBe(true);
    expect(isPreviewUpgrade('/api/v1/sandboxes/sbx-1/pty')).toBe(false);
    expect(isPreviewUpgrade('/api/fs/sbx-1/events')).toBe(false);
  });
});

// The dev server inside the sandbox has never heard of our ingress. Forward it
// `/preview/sbx-1/5173/@vite/client` and it 404s the hot-reload socket — the exact
// silent failure that makes HMR "just not work" with nothing in any log.
describe('stripPreviewPrefix', () => {
  it('strips the mount prefix, leaving the path the dev server expects', () => {
    expect(stripPreviewPrefix('/preview/sbx-1/5173/@vite/client')).toBe('/@vite/client');
  });

  it('keeps the query string — Vite passes its HMR token there', () => {
    expect(stripPreviewPrefix('/preview/sbx-1/5173/?token=abc123')).toBe('/?token=abc123');
  });

  it('maps the bare root to "/", never to an empty URL', () => {
    expect(stripPreviewPrefix('/preview/sbx-1/5173')).toBe('/');
    expect(stripPreviewPrefix('/preview/sbx-1/5173/')).toBe('/');
  });

  it('leaves a non-preview URL alone', () => {
    expect(stripPreviewPrefix('/api/v1/sandboxes/sbx-1/pty')).toBe('/api/v1/sandboxes/sbx-1/pty');
  });
});
