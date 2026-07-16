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

  // -------------------------------------------------------------------------
  // Endpoint resolution. THE BUG THIS PINS: a user's dev server was resolved to the
  // DEFAULT endpoint — execd's embedded proxy — which forwards execd's own port but
  // hangs up on an application port. A real server on :8000 answered 200 through the
  // daemon's proxy route and dropped the connection through execd's, so every preview
  // 502'd with "socket hang up". App ports go through the daemon (`use_server_proxy`);
  // execd stays direct. Mixing the two up breaks either the preview or the terminal.
  // -------------------------------------------------------------------------

  it("asks for the daemon's server proxy for an app port — execd's proxy hangs up on those", async () => {
    const fetchMock = mockFetch([
      {
        method: 'GET',
        match: /\/endpoints\/3000\?use_server_proxy=true$/,
        res: { json: async () => ({ endpoint: '127.0.0.1:8080/sandboxes/sbx-1/proxy/3000' }) },
      },
    ]);
    global.fetch = fetchMock as any;

    const endpoint = await new OpenSandboxEngine().resolveEndpoint('sbx-1', 3000);

    // Scheme added, port/path preserved — appending :3000 here would break the route.
    expect(endpoint.url).toBe('http://127.0.0.1:8080/sandboxes/sbx-1/proxy/3000');
    expect(fetchMock.calls[0].url).toContain('use_server_proxy=true');
  });

  it('carries the headers the daemon requires with an endpoint, instead of dropping them', async () => {
    // A keyed deployment 401s on every proxied request without this.
    process.env.OPENSANDBOX_API_KEY = 'secret-key';
    global.fetch = mockFetch([
      {
        method: 'GET',
        match: /\/endpoints\/3000/,
        res: { json: async () => ({ endpoint: 'host/x', headers: { 'X-Egress-Auth': 'tok' } }) },
      },
    ]) as any;

    try {
      const endpoint = await new OpenSandboxEngine().resolveEndpoint('sbx-1', 3000);
      expect(endpoint.headers).toEqual({
        'X-Egress-Auth': 'tok',              // the daemon's own required header
        'OPEN-SANDBOX-API-KEY': 'secret-key', // ours: the proxy route is behind its auth middleware
      });
    } finally {
      delete process.env.OPENSANDBOX_API_KEY;
    }
  });

  it('fails loudly when a port has no endpoint — there is no IP to fall back to', async () => {
    global.fetch = mockFetch([
      { method: 'GET', match: /\/endpoints\/3000/, res: { ok: false, status: 404, text: async () => 'not listening' } },
    ]) as any;

    await expect(new OpenSandboxEngine().resolveEndpoint('sbx-1', 3000)).rejects.toThrow(
      /No endpoint for port 3000/,
    );
  });

  it('reaches execd on the DIRECT endpoint, not through the daemon proxy', async () => {
    // The real execd wire format: bare JSON lines, one line of output per event, no SSE
    // `data: ` prefix. This mock used to invent the prefix — which is precisely why the
    // parser could skip every event in production while this suite stayed green.
    const stream = [
      '{"type":"init","text":"abc123"}',
      '',
      '{"type":"stdout","text":"hello"}',
      '',
      '{"type":"stderr","text":"warn"}',
      '',
      '{"type":"stdout","text":"world"}',
      '',
      '{"type":"execution_complete","execution_time":6}',
    ].join('\n');

    const fetchMock = mockFetch([
      { method: 'GET', match: /\/endpoints\/44772$/, res: { json: async () => ({ endpoint: '127.0.0.1:44772' }) } },
      { method: 'POST', match: /\/command$/, res: { text: async () => stream } },
    ]);
    global.fetch = fetchMock as any;

    const result = await new OpenSandboxEngine().execCommand('sbx-1', {
      command: ['/bin/sh', '-c', 'echo hi'],
    });

    expect(result).toEqual({ stdout: 'hello\nworld\n', stderr: 'warn\n', exitCode: 0 });
    // No use_server_proxy: relaying the terminal's SSE stream through the daemon's
    // Python proxy buys nothing, and the direct path is what works today.
    expect(fetchMock.calls[0].url).not.toContain('use_server_proxy');
    // A bare host still gets the port appended (the branch the old test covered).
    expect(fetchMock.calls[1].url).toBe('http://127.0.0.1:44772/command');
  });

  it('retries exec when execd is not accepting connections yet (cold boot), then succeeds', async () => {
    process.env.EXEC_CONNECT_RETRY_DELAY_MS = '1'; // keep the test instant
    let commandCalls = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (/\/endpoints\/44772$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ endpoint: '127.0.0.1:44772' }) } as any;
      }
      // First two /command attempts: connection refused (execd still starting).
      if (++commandCalls <= 2) {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }
      return {
        ok: true, status: 200,
        text: async () => '{"type":"stdout","text":"hi"}\n{"type":"exit","exitCode":0}',
      } as any;
    }) as any;

    const result = await new OpenSandboxEngine().execCommand('sbx-1', { command: ['echo hi'] });
    expect(result.exitCode).toBe(0);
    expect(commandCalls).toBe(3);
    delete process.env.EXEC_CONNECT_RETRY_DELAY_MS;
  });

  it('never retries once execd has answered — a 500 surfaces immediately', async () => {
    let commandCalls = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (/\/endpoints\/44772$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ endpoint: '127.0.0.1:44772' }) } as any;
      }
      commandCalls++;
      return { ok: false, status: 500, text: async () => 'boom' } as any;
    }) as any;

    await expect(
      new OpenSandboxEngine().execCommand('sbx-1', { command: ['echo hi'] }),
    ).rejects.toThrow(/status 500/);
    expect(commandCalls).toBe(1); // answered = command may have run = no retry
  });

  it('destroy treats 404 as success', async () => {
    global.fetch = mockFetch([
      { method: 'DELETE', match: /\/v1\/sandboxes\/sbx-2$/, res: { ok: false, status: 404 } },
    ]) as any;

    expect(await new OpenSandboxEngine().destroySandbox('sbx-2')).toBe(true);
  });
});
