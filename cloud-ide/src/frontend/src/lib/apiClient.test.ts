import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCsrfToken, postStream } from './apiClient';

describe('parseCsrfToken', () => {
  it('extracts the token from a cookie string', () => {
    expect(parseCsrfToken('csrf-token=abc123')).toBe('abc123');
    expect(parseCsrfToken('session=xyz; csrf-token=abc123; other=1')).toBe('abc123');
    expect(parseCsrfToken('csrf-token=a%2Bb%3Dc')).toBe('a+b=c'); // URL-decoded
  });

  it('returns empty string when absent', () => {
    expect(parseCsrfToken('')).toBe('');
    expect(parseCsrfToken('session=xyz; other=1')).toBe('');
    // must not match a different cookie whose name ends in csrf-token
    expect(parseCsrfToken('x-csrf-token=nope')).toBe('');
  });
});

describe('postStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(cookie = 'csrf-token=tok123') {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { cookie });
    return fetchMock;
  }

  // A cold load that POSTs before ever issuing a GET has no csrf-token cookie, and
  // the backend 403s it. GET /api/csrf exists to prime the cookies; nothing called it.
  it('primes the csrf cookie when the app has never talked to the API', async () => {
    const doc = { cookie: '' };
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).endsWith('/csrf')) doc.cookie = 'csrf-token=minted';
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', doc);

    await postStream('http://api/x/exec', { body: { a: 1 } });

    const [primeUrl, primeInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(primeUrl).toMatch(/\/csrf$/);
    expect(primeInit.credentials).toBe('include');

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('minted');
  });

  it('does not re-prime when a token already exists', async () => {
    const fetchMock = stubFetch();
    await postStream('http://api/x/exec', { body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no /csrf round trip
  });

  // Both are required or the backend 403s every mutating request: the CSRF
  // middleware compares the header against the cookie, and without
  // credentials:'include' the cookie never crosses the Vite->API origin at all.
  it('always sends the CSRF header and the cookies', async () => {
    const fetchMock = stubFetch();
    await postStream('http://api/x/build');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok123');
    expect(init.credentials).toBe('include');
  });

  it('serialises a body and sets Content-Type only when there is one', async () => {
    const fetchMock = stubFetch();

    await postStream('http://api/x/exec', { body: { command: ['ls'] } });
    let [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"command":["ls"]}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    // A bodyless POST (the build stream) must not claim a JSON body.
    await postStream('http://api/x/build');
    [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('forwards the abort signal so the stream can be cancelled', async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();
    await postStream('http://api/x/exec', { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
