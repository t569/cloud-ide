import { Duplex } from 'node:stream';
import { LspProxy, parseLspServers, NoLanguageServerError } from './LspProxy';
import { encodeMessage, MessageBuffer } from './framing';

// A fake language server: auto-answers initialize, records notifications, and
// replies to textDocument/completion. Lets us drive the whole proxy path
// (connect -> handshake -> lazy didOpen -> request -> map result) with no socket.
class FakeLsp extends Duplex {
  private inbound = new MessageBuffer();
  seen: any[] = [];
  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.inbound.append(chunk);
    for (const msg of this.inbound.drain()) {
      this.seen.push(msg);
      if (msg.method === 'initialize') this.reply({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      if (msg.method === 'textDocument/completion') {
        this.reply({ jsonrpc: '2.0', id: msg.id, result: { items: [{ label: 'os', kind: 9 }] } }); // 9 = Module
      }
    }
    cb();
  }
  private reply(m: unknown): void { this.push(encodeMessage(m)); }
}

function makeProxy(fake: FakeLsp) {
  const readFile = jest.fn(async () => 'import os\n');
  const proxy = new LspProxy({
    serverFor: (lang) => (lang === 'python' ? { host: 'x', port: 1 } : null),
    hostPathFor: async (_sb, p) => `/wt/sb1${p.replace(/^\/workspace/, '')}`,
    rootHostPath: async () => '/wt/sb1',
    readFile,
    connect: async () => fake,
  });
  return { proxy, readFile };
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
});

describe('parseLspServers', () => {
  it('parses a semicolon-separated host:port spec', () => {
    const m = parseLspServers('python=127.0.0.1:2087; typescript = ls.local:2089');
    expect(m.get('python')).toEqual({ host: '127.0.0.1', port: 2087 });
    expect(m.get('typescript')).toEqual({ host: 'ls.local', port: 2089 });
  });
  it('is empty for undefined/blank and skips malformed entries', () => {
    expect(parseLspServers(undefined).size).toBe(0);
    expect(parseLspServers('garbage;python=1.2.3.4:5').size).toBe(1);
  });
});
