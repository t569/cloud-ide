// The loopback execd stand-in, driven over REAL HTTP the way SandboxController drives it —
// POST {command, cwd, env} and read the streamed body. The wire format is a contract with
// the frontend parser, so these assert bytes, not intentions.
import { WasmExecdShim, argvFromShellish, ExecLineSource } from './wasmExecdShim';

/** Records what it was asked to run and replays scripted lines. */
function fakeSource(lines: [('stdout' | 'stderr'), string][] = [], exitCode = 0): ExecLineSource & {
  calls: { sandboxId: string; command: string[]; env?: Record<string, string> }[];
} {
  const calls: any[] = [];
  return {
    calls,
    async execLines(sandboxId, command, env, onLine) {
      calls.push({ sandboxId, command, env });
      for (const [type, text] of lines) onLine(type, text);
      return exitCode;
    },
  };
}

describe('argvFromShellish', () => {
  it('drops the transport preamble the terminal always prepends', () => {
    expect(argvFromShellish('export TERM=xterm-256color; hello world')).toEqual(['hello', 'world']);
    expect(argvFromShellish('export A=1; export B=2; run')).toEqual(['run']);
  });

  it('passes a plain command through', () => {
    expect(argvFromShellish('  python  main.py ')).toEqual(['python', 'main.py']);
  });

  it('splits naively — the documented ceiling, not a bug', () => {
    // No shell means no quoting. Asserted so the limitation is visible rather than
    // discovered later by someone whose filename had a space in it.
    expect(argvFromShellish('cat "two words.txt"')).toEqual(['cat', '"two', 'words.txt"']);
  });
});

describe('WasmExecdShim', () => {
  let shim: WasmExecdShim;

  afterEach(async () => { await shim?.stop(); });

  const post = (url: string, body: unknown, token?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-EXECD-ACCESS-TOKEN': token } : {}),
      },
      body: JSON.stringify(body),
    });

  it('streams RAW JSON LINES, not SSE — the frontend parses newline JSON', async () => {
    const source = fakeSource([['stdout', 'first'], ['stderr', 'oops'], ['stdout', 'second']]);
    shim = new WasmExecdShim(source);
    await shim.start();

    const res = await post(`${shim.baseUrl('wsm-1')}/command`, { command: 'hello' }, shim.token);
    expect(res.status).toBe(200);
    const text = await res.text();

    // Exactly one JSON object per line, no `data: ` prefix anywhere.
    expect(text).not.toContain('data: ');
    const events = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(events).toEqual([
      { type: 'stdout', text: 'first' },
      { type: 'stderr', text: 'oops' },
      { type: 'stdout', text: 'second' },
    ]);
  });

  it('hands the driver argv, with the shell preamble already stripped', async () => {
    const source = fakeSource();
    shim = new WasmExecdShim(source);
    await shim.start();
    await post(
      `${shim.baseUrl('wsm-abc')}/command`,
      { command: 'export TERM=xterm-256color; writefile out.txt', env: { A: '1' } },
      shim.token,
    );
    expect(source.calls).toEqual([
      { sandboxId: 'wsm-abc', command: ['writefile', 'out.txt'], env: { A: '1' } },
    ]);
  });

  it('reports a non-zero exit down the same stream', async () => {
    shim = new WasmExecdShim(fakeSource([['stdout', 'partial']], 3));
    await shim.start();
    const text = await (await post(`${shim.baseUrl('s')}/command`, { command: 'x' }, shim.token)).text();
    expect(text).toContain('"exited with code 3"');
  });

  it('sends a driver refusal down the stream rather than dying', async () => {
    const source: ExecLineSource = { execLines: async () => { throw new Error('Unknown sandbox s.'); } };
    shim = new WasmExecdShim(source);
    await shim.start();
    const res = await post(`${shim.baseUrl('s')}/command`, { command: 'x' }, shim.token);
    expect(res.status).toBe(200); // the stream was already open; the error is content
    expect(JSON.parse((await res.text()).trim())).toEqual({ type: 'stderr', text: 'Unknown sandbox s.' });
  });

  it('binds loopback only and refuses a request without the token', async () => {
    shim = new WasmExecdShim(fakeSource());
    const port = await shim.start();
    expect(shim.baseUrl('s')).toBe(`http://127.0.0.1:${port}/s`);
    expect((await post(`${shim.baseUrl('s')}/command`, { command: 'x' })).status).toBe(403);
    expect((await post(`${shim.baseUrl('s')}/command`, { command: 'x' }, 'wrong')).status).toBe(403);
  });

  it('404s anything that is not the command route', async () => {
    shim = new WasmExecdShim(fakeSource());
    await shim.start();
    expect((await post(`${shim.baseUrl('s')}/other`, {}, shim.token)).status).toBe(404);
  });

  it('start() is idempotent — the port does not move', async () => {
    shim = new WasmExecdShim(fakeSource());
    expect(await shim.start()).toBe(await shim.start());
  });
});
