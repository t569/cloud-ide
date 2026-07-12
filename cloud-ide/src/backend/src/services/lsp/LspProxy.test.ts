import { Duplex } from 'node:stream';
import { LspProxy, parseLspServers, NoLanguageServerError } from './LspProxy';
import { encodeMessage, MessageBuffer } from './framing';

// A fake language server: auto-answers initialize, records notifications, and
// replies to textDocument/completion. Lets us drive the whole proxy path
// (connect -> handshake -> lazy didOpen -> request -> map result) with no socket.
class FakeLsp extends Duplex {
  private inbound = new MessageBuffer();
  seen: any[] = [];
  /** What textDocument/definition resolves to; set per-test. */
  definition: unknown = null;
  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.inbound.append(chunk);
    for (const msg of this.inbound.drain()) {
      this.seen.push(msg);
      if (msg.method === 'initialize') this.reply({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      if (msg.method === 'textDocument/completion') {
        this.reply({ jsonrpc: '2.0', id: msg.id, result: { items: [{ label: 'os', kind: 9 }] } }); // 9 = Module
      }
      if (msg.method === 'textDocument/definition') {
        this.reply({ jsonrpc: '2.0', id: msg.id, result: this.definition });
      }
    }
    cb();
  }
  private reply(m: unknown): void { this.push(encodeMessage(m)); }
}

function makeProxy(fake: FakeLsp) {
  const readFile = jest.fn(async () => 'import os\n');
  const proxy = new LspProxy({
    serverFor: (lang) => (lang === 'python' ? { kind: 'tcp', host: 'x', port: 1 } : null),
    hostPathFor: async (_sb, p) => `/wt/sb1${p.replace(/^\/workspace/, '')}`,
    rootHostPath: async () => '/wt/sb1',
    readFile,
    connect: async () => fake,
  });
  return { proxy, readFile };
}

/** A proxy whose python server runs INSIDE the sandbox (docker-exec stdio). */
function makeExecProxy(fake: FakeLsp) {
  const openExecStream = jest.fn(async () => fake);
  const hostPathFor = jest.fn(async (_sb: string, p: string) => `/wt/sb1${p}`);
  const proxy = new LspProxy({
    serverFor: (lang) =>
      lang === 'python' ? { kind: 'exec', command: ['pyright-langserver', '--stdio'] } : null,
    hostPathFor,
    rootHostPath: async () => '/wt/sb1',
    readFile: async () => 'import os\n',
    openExecStream,
  });
  return { proxy, openExecStream, hostPathFor };
}

describe('LspProxy', () => {
  it('lazily opens the doc from disk, then answers a mapped completion', async () => {
    const fake = new FakeLsp();
    const { proxy, readFile } = makeProxy(fake);

    const result = await proxy.request('sb1', 'python', 'completion', {
      path: '/workspace/main.py',
      position: { line: 0, character: 3 },
    });

    expect(result).toEqual([{ label: 'os', kind: 'module', insertText: 'os', detail: undefined, documentation: undefined }]);
    expect(readFile).toHaveBeenCalledWith('sb1', '/workspace/main.py'); // hybrid: read from worktree
    const didOpen = fake.seen.find((m) => m.method === 'textDocument/didOpen');
    expect(didOpen?.params.textDocument.uri).toBe('file:///wt/sb1/main.py');
  });

  it('opens each document only once across repeated requests', async () => {
    const fake = new FakeLsp();
    const { proxy, readFile } = makeProxy(fake);
    const params = { path: '/workspace/main.py', position: { line: 0, character: 0 } };

    await proxy.request('sb1', 'python', 'completion', params);
    await proxy.request('sb1', 'python', 'completion', params);

    expect(readFile).toHaveBeenCalledTimes(1); // second request reuses the open doc
    expect(fake.seen.filter((m) => m.method === 'textDocument/didOpen')).toHaveLength(1);
  });

  it('throws NoLanguageServerError for an unconfigured language', async () => {
    const { proxy } = makeProxy(new FakeLsp());
    await expect(proxy.request('sb1', 'ruby', 'completion', { path: '/workspace/x.rb' }))
      .rejects.toBeInstanceOf(NoLanguageServerError);
  });

  // Go-to-definition mostly lands OUTSIDE the worktree (the stdlib, site-packages).
  // Such a target must come back as its real absolute path, so the editor opens it
  // read-only. It used to be prefixed regardless — /usr/lib/python3.11/os.py came
  // back as /workspace/usr/lib/python3.11/os.py, a file that does not exist and
  // which a write would have created in the worktree.
  it('maps a definition inside the worktree to /workspace, and leaves an external one absolute', async () => {
    const fake = new FakeLsp();
    const { proxy } = makeProxy(fake);
    const range = { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } };
    const ask = () => proxy.request('sb1', 'python', 'definition', {
      path: '/workspace/main.py',
      position: { line: 0, character: 8 },
    });

    fake.definition = [{ uri: 'file:///wt/sb1/lib/helper.py', range }];
    expect(await ask()).toEqual([{ path: '/workspace/lib/helper.py', range }]);

    fake.definition = [{ uri: 'file:///usr/lib/python3.11/os.py', range }];
    expect(await ask()).toEqual([{ path: '/usr/lib/python3.11/os.py', range }]);

    // A sibling worktree is not "inside" ours just because the string prefixes.
    fake.definition = [{ uri: 'file:///wt/sb10/secrets.py', range }];
    expect(await ask()).toEqual([{ path: '/wt/sb10/secrets.py', range }]);
  });
});

// An in-container server sees the container's filesystem, so /workspace paths are
// ALREADY its paths — no host mapping in either direction. Mapping them anyway (the
// bug this guards) would hand the server /wt/sb1/main.py, a path that does not exist
// inside the container, and every request would resolve nothing.
describe('LspProxy — in-sandbox (exec) servers', () => {
  it('spawns the configured command and speaks container paths, unmapped', async () => {
    const fake = new FakeLsp();
    const { proxy, openExecStream, hostPathFor } = makeExecProxy(fake);
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } };
    fake.definition = [{ uri: 'file:///usr/lib/python3.11/os.py', range }];

    const result = await proxy.request('sb1', 'python', 'definition', {
      path: '/workspace/main.py',
      position: { line: 0, character: 8 },
    });

    expect(openExecStream).toHaveBeenCalledWith('sb1', ['pyright-langserver', '--stdio']);
    expect(hostPathFor).not.toHaveBeenCalled(); // the host mapping must not be applied

    // didOpen carried the CONTAINER path, not the worktree's host path.
    const didOpen = fake.seen.find((m) => m.method === 'textDocument/didOpen');
    expect(didOpen?.params.textDocument.uri).toBe('file:///workspace/main.py');

    // A stdlib target inside the container comes back as-is, for the read-only opener.
    expect(result).toEqual([{ path: '/usr/lib/python3.11/os.py', range }]);
  });

  it('reports the language offline when the driver cannot open exec streams', async () => {
    const proxy = new LspProxy({
      serverFor: () => ({ kind: 'exec', command: ['rust-analyzer'] }),
      hostPathFor: async (_sb, p) => p,
      rootHostPath: async () => '/wt/sb1',
      readFile: async () => '',
      // no openExecStream — e.g. the exec-only Rust kernel driver
    });
    await expect(proxy.request('sb1', 'rust', 'completion', { path: '/workspace/m.rs' }))
      .rejects.toBeInstanceOf(NoLanguageServerError);
  });

  it('evicts a session when its stream dies, so the next request reconnects', async () => {
    const first = new FakeLsp();
    const { proxy } = makeExecProxy(first);
    const params = { path: '/workspace/main.py', position: { line: 0, character: 0 } };

    await proxy.request('sb1', 'python', 'completion', params);
    expect(proxy.sessionCount()).toBe(1);

    // The container died (destroy/pause) — docker exec exits, the stream closes.
    first.destroy();
    await new Promise((r) => setImmediate(r));

    // Previously the dead session stayed cached and every later request failed forever.
    expect(proxy.sessionCount()).toBe(0);
  });
});

describe('parseLspServers — exec entries', () => {
  it('parses exec: argv, keeps host:port, and skips malformed entries', () => {
    const m = parseLspServers(
      'python=exec:pyright-langserver --stdio;rust=exec:rust-analyzer;ts=127.0.0.1:2089;junk=;bad=exec:',
    );
    expect(m.get('python')).toEqual({ kind: 'exec', command: ['pyright-langserver', '--stdio'] });
    expect(m.get('rust')).toEqual({ kind: 'exec', command: ['rust-analyzer'] });
    expect(m.get('ts')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 2089 });
    expect(m.has('junk')).toBe(false);
    expect(m.has('bad')).toBe(false); // `exec:` with no command is not a server
  });
});

describe('parseLspServers', () => {
  it('parses a semicolon-separated host:port spec', () => {
    const m = parseLspServers('python=127.0.0.1:2087; typescript = ls.local:2089');
    expect(m.get('python')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 2087 });
    expect(m.get('typescript')).toEqual({ kind: 'tcp', host: 'ls.local', port: 2089 });
  });
  it('is empty for undefined/blank and skips malformed entries', () => {
    expect(parseLspServers(undefined).size).toBe(0);
    expect(parseLspServers('garbage;python=1.2.3.4:5').size).toBe(1);
  });
});
