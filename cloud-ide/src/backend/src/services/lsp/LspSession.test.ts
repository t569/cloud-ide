import { Duplex } from 'node:stream';
import { LspSession } from './LspSession';
import { encodeMessage, MessageBuffer } from './framing';

// An in-memory language server: decodes the client's frames and lets the test
// script the replies. Proves the whole protocol layer without a real socket.
class FakeLsp extends Duplex {
  private inbound = new MessageBuffer();
  seen: any[] = [];
  onRequest?: (msg: any, reply: (m: any) => void) => void;

  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.inbound.append(chunk);
    for (const msg of this.inbound.drain()) {
      this.seen.push(msg);
      this.onRequest?.(msg, (m) => this.push(encodeMessage(m)));
    }
    cb();
  }
  emitFromServer(msg: unknown): void {
    this.push(encodeMessage(msg));
  }
}

function autoInitialize(fake: FakeLsp): void {
  fake.onRequest = (msg, reply) => {
    if (msg.method === 'initialize') reply({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
  };
}

describe('LspSession', () => {
  it('completes the initialize/initialized handshake', async () => {
    const fake = new FakeLsp();
    autoInitialize(fake);
    const session = new LspSession(fake);

    await session.ready();

    const methods = fake.seen.map((m) => m.method);
    expect(methods).toContain('initialize');
    expect(methods).toContain('initialized'); // the follow-up notification
  });

  it('correlates a request with its response by id', async () => {
    const fake = new FakeLsp();
    fake.onRequest = (msg, reply) => {
      if (msg.method === 'initialize') return reply({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (msg.method === 'textDocument/hover') {
        reply({ jsonrpc: '2.0', id: msg.id, result: { contents: 'hi there' } });
      }
    };
    const session = new LspSession(fake);
    await session.ready();

    const result = await session.request('textDocument/hover', { position: { line: 0, character: 0 } });
    expect(result).toEqual({ contents: 'hi there' });
  });

  it('rejects when the server returns an error', async () => {
    const fake = new FakeLsp();
    fake.onRequest = (msg, reply) => {
      if (msg.method === 'initialize') return reply({ jsonrpc: '2.0', id: msg.id, result: {} });
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    };
    const session = new LspSession(fake);
    await session.ready();

    await expect(session.request('textDocument/nope', {})).rejects.toThrow('Method not found');
  });

  it('fans out pushed diagnostics with the uri mapped back to a path', async () => {
    const fake = new FakeLsp();
    autoInitialize(fake);
    const session = new LspSession(fake);
    await session.ready();

    const got: Array<{ path: string; diagnostics: any[] }> = [];
    session.onDiagnostics((path, diagnostics) => got.push({ path, diagnostics }));

    fake.emitFromServer({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///workspace/main.py', diagnostics: [{ message: 'undefined name' }] },
    });
    await new Promise((r) => setImmediate(r)); // let the frame arrive

    expect(got).toEqual([{ path: '/workspace/main.py', diagnostics: [{ message: 'undefined name' }] }]);
  });
});
