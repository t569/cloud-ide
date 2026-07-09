import { OpenSandboxEngine } from './openSandboxEngine';

// Every response body here is the shape upstream actually returns
// (server/opensandbox_server/api/schema.py). The previous suite mocked a
// `status.ip` / `status.phase` daemon that has never existed, which is exactly why
// it stayed green while every real boot 400'd. Do not reintroduce those fields.
function mockFetch(
  routes: Array<{
    method: string;
    match: RegExp;
    res: Partial<Response> & { json?: () => any; text?: () => any };
  }>,
) {
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const hit = routes.find((r) => r.method === method && r.match.test(url));
    if (!hit) throw new Error(`no mock for ${method} ${url}`);
    return {
      ok: hit.res.ok ?? true,
      status: hit.res.status ?? 200,
      json: hit.res.json ?? (async () => ({})),
      text: hit.res.text ?? (async () => ''),
    } as unknown as Response;
  });
  return Object.assign(fn, { calls });
}

const running = (id: string) => ({ id, status: { state: 'Running' } });

describe('OpenSandboxEngine', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('boots with Kubernetes-quantity resource limits the daemon actually reads', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', match: /\/v1\/sandboxes$/, res: { status: 202, json: async () => running('sbx-1') } },
    ]);
    global.fetch = fetchMock as any;

    const status = await new OpenSandboxEngine().bootSandbox({
      imageTag: 'img:latest',
      resourceLimits: { cpuCount: 2, memoryMb: 1024 },
    });

    expect(status).toEqual({
      sandboxId: 'sbx-1',
      state: 'RUNNING',
      execdPort: 44772,
      message: 'OpenSandbox status resolved',
    });

    const payload = fetchMock.calls[0].body;
    // `cpu`/`memory`, not `cpuCount`/`memoryMb` — wrong keys are accepted by pydantic
    // and then silently dropped, booting the container with no caps at all.
    expect(payload.resourceLimits).toEqual({ cpu: '2', memory: '1024Mi' });
    // A bare `memory` number means BYTES; the Mi suffix is what makes it megabytes.
    expect(payload.resourceLimits.memory).toMatch(/Mi$/);
    // Neither of these is a field on CreateSandboxRequest.
    expect(payload.image).toEqual({ uri: 'img:latest' });
    expect(payload).not.toHaveProperty('exposedPorts');
  });

  it('defaults limits rather than booting uncapped', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', match: /\/v1\/sandboxes$/, res: { json: async () => running('sbx-1') } },
    ]);
    global.fetch = fetchMock as any;

    await new OpenSandboxEngine().bootSandbox({ imageTag: 'img:latest' });
    expect(fetchMock.calls[0].body.resourceLimits).toEqual({ cpu: '1', memory: '512Mi' });
  });

  it('sends no TTL — timeout is an absolute deadline, not an idle timer', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', match: /\/v1\/sandboxes$/, res: { json: async () => running('sbx-1') } },
    ]);
    global.fetch = fetchMock as any;

    await new OpenSandboxEngine().bootSandbox({ imageTag: 'img:latest' });
    // A number here reaps active users' sandboxes at the deadline. IdleSweeper owns this.
    expect(fetchMock.calls[0].body.timeout).toBeNull();
  });

  it('surfaces the daemon body on a rejected boot', async () => {
    global.fetch = mockFetch([
      {
        method: 'POST',
        match: /\/v1\/sandboxes$/,
        res: { ok: false, status: 400, text: async () => '{"code":"HOST_PATH_NOT_ALLOWED"}' },
      },
    ]) as any;

    await expect(new OpenSandboxEngine().bootSandbox({ imageTag: 'img:latest' })).rejects.toThrow(
      /400 .*HOST_PATH_NOT_ALLOWED/,
    );
  });

  const stateCases: Array<[string, string]> = [
    ['Pending', 'PROVISIONING'],
    ['Resuming', 'PROVISIONING'], // was ERROR: broke wake-on-demand
    ['Running', 'RUNNING'],
    ['Pausing', 'PAUSED'],
    ['Paused', 'PAUSED'],
    ['Stopping', 'STOPPED'],
    ['Terminated', 'STOPPED'], // was ERROR: broke IdleSweeper reconciliation
    ['Failed', 'ERROR'],
    ['SomethingNew', 'ERROR'],
  ];

  it.each(stateCases)('maps daemon state %s -> %s', async (daemonState: string, expected: string) => {
    global.fetch = mockFetch([
      { method: 'GET', match: /\/v1\/sandboxes\/sbx-1$/, res: { json: async () => ({ id: 'sbx-1', status: { state: daemonState } }) } },
    ]) as any;

    const status = await new OpenSandboxEngine().getSandboxStatus('sbx-1');
    expect(status.state).toBe(expected);
  });

  it('resolves an endpoint per port and leaves a proxy path intact', async () => {
    global.fetch = mockFetch([
      { method: 'GET', match: /\/endpoints\/3000$/, res: { json: async () => ({ endpoint: '127.0.0.1:45792/proxy/3000' }) } },
    ]) as any;

    // Scheme added, port/path preserved — appending :3000 here would break the proxy.
    expect(await new OpenSandboxEngine().resolveEndpoint('sbx-1', 3000)).toBe(
      'http://127.0.0.1:45792/proxy/3000',
    );
  });

  it('appends the port only to a bare host', async () => {
    global.fetch = mockFetch([
      { method: 'GET', match: /\/endpoints\/44772$/, res: { json: async () => ({ endpoint: 'sandbox.internal' }) } },
    ]) as any;

    expect(await new OpenSandboxEngine().resolveEndpoint('sbx-1', 44772)).toBe(
      'http://sandbox.internal:44772',
    );
  });

  it('fails loudly when a port has no endpoint — there is no IP to fall back to', async () => {
    global.fetch = mockFetch([
      { method: 'GET', match: /\/endpoints\/3000$/, res: { ok: false, status: 404, text: async () => 'not listening' } },
    ]) as any;

    await expect(new OpenSandboxEngine().resolveEndpoint('sbx-1', 3000)).rejects.toThrow(
      /No endpoint for port 3000/,
    );
  });

  it('exec resolves execd then parses the SSE stream', async () => {
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

    const result = await new OpenSandboxEngine().execCommand('sbx-1', {
      command: ['/bin/sh', '-c', 'echo hi'],
    });

    expect(result).toEqual({ stdout: 'hello world', stderr: 'warn', exitCode: 0 });
  });

  it('destroy treats 404 as success', async () => {
    global.fetch = mockFetch([
      { method: 'DELETE', match: /\/v1\/sandboxes\/sbx-2$/, res: { ok: false, status: 404 } },
    ]) as any;

    expect(await new OpenSandboxEngine().destroySandbox('sbx-2')).toBe(true);
  });
});
