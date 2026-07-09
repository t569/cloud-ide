import { OpenSandboxEngine } from './openSandboxEngine';

// Route a fake fetch by method+path. Mirrors the Rust wiremock suite it replaces.
function mockFetch(routes: Array<{ method: string; match: RegExp; res: Partial<Response> & { json?: () => any; text?: () => any } }>) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const hit = routes.find((r) => r.method === method && r.match.test(url));
    if (!hit) throw new Error(`no mock for ${method} ${url}`);
    return {
      ok: hit.res.ok ?? true,
      status: hit.res.status ?? 200,
      json: hit.res.json ?? (async () => ({})),
      text: hit.res.text ?? (async () => ''),
    } as unknown as Response;
  });
}

describe('OpenSandboxEngine', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('boot maps RUNNING and caches the IP for routing', async () => {
    global.fetch = mockFetch([
      { method: 'POST', match: /\/v1\/sandboxes$/, res: { status: 201, json: async () => ({ id: 'sbx-1', status: { ip: '10.0.0.25', phase: 'Running' } }) } },
    ]) as any;

    const engine = new OpenSandboxEngine();
    const status = await engine.bootSandbox({ imageTag: 'img:latest' });

    expect(status.sandboxId).toBe('sbx-1');
    expect(status.state).toBe('RUNNING');
    expect(engine.getSandboxIp('sbx-1')).toBe('10.0.0.25');
  });

  it('exec resolves the endpoint then parses the SSE stream', async () => {
    const sse = [
      'data: {"type":"stdout","text":"hello "}',
      'data: {"type":"stderr","text":"warn"}',
      'data: {"type":"stdout","text":"world"}',
      'data: {"type":"result","exitCode":0}',
    ].join('\n');

    global.fetch = mockFetch([
      { method: 'GET', match: /\/endpoints\/44772$/, res: { json: async () => ({ endpoint: '127.0.0.1:44772' }) } },
      { method: 'POST', match: /\/command$/, res: { text: async () => sse } },
    ]) as any;

    const engine = new OpenSandboxEngine();
    const result = await engine.execCommand('sbx-1', { command: ['/bin/sh', '-c', 'echo hi'] });

    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('destroy treats 404 as success and drops the cached IP', async () => {
    global.fetch = mockFetch([
      { method: 'POST', match: /\/v1\/sandboxes$/, res: { json: async () => ({ id: 'sbx-2', status: { ip: '10.0.0.9', phase: 'Running' } }) } },
      { method: 'DELETE', match: /\/v1\/sandboxes\/sbx-2$/, res: { ok: false, status: 404 } },
    ]) as any;

    const engine = new OpenSandboxEngine();
    await engine.bootSandbox({ imageTag: 'img:latest' });
    expect(engine.getSandboxIp('sbx-2')).toBe('10.0.0.9');

    expect(await engine.destroySandbox('sbx-2')).toBe(true);
    expect(engine.getSandboxIp('sbx-2')).toBeNull();
  });
});
