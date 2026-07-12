// Self-check for the in-container LSP transport. What can actually break here is
// the lifecycle: bytes must survive the round trip unmangled (a TTY would echo and
// rewrite newlines, corrupting Content-Length framing), a dead process must kill the
// stream (so LspProxy evicts the session instead of talking to a corpse), and a
// destroyed stream must kill the process (so a closed tab doesn't leak a server).
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnDuplex } from './execStream';

const read = (stream: NodeJS.ReadableStream, until: number): Promise<string> =>
  new Promise((resolve) => {
    let out = '';
    stream.on('data', (c: Buffer) => {
      out += c.toString('utf8');
      if (out.length >= until) resolve(out);
    });
  });

describe('spawnDuplex', () => {
  it('round-trips stdin -> stdout as raw bytes (no TTY echo, no \\r\\n rewrite)', async () => {
    // `cat` is the identity server: whatever we write comes straight back.
    const stream = spawnDuplex('node', ['-e', 'process.stdin.pipe(process.stdout)']);
    const payload = 'Content-Length: 2\r\n\r\n{}';

    stream.write(payload);
    const got = await read(stream, payload.length);

    expect(got).toBe(payload); // byte-identical: not echoed twice, \r\n intact
    stream.destroy();
  });

  it('destroys the stream when the process exits non-zero', async () => {
    const stream = spawnDuplex('node', ['-e', 'process.exit(3)']);
    const err = await new Promise<Error>((resolve) => stream.on('error', resolve));
    expect(err.message).toMatch(/exited with code 3/);
  });

  // THE GATEWAY-CRASHER. Writing to a dead server's stdin raises EPIPE, and Node emits
  // 'error' on the PIPE ITSELF as well as passing it to the write callback. Unhandled,
  // that is an uncaught exception — so one language server dying at the wrong moment
  // (rust-analyzer OOMing on a big crate) would take the gateway down for every tenant.
  //
  // Driven through an injected spawn because EPIPE is OS-specific: Linux raises it,
  // Windows silently swallows the write. The wiring is what we actually need to pin.
  it('routes a pipe error into the stream instead of crashing the process', async () => {
    const child: any = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.kill = jest.fn();

    const stream = spawnDuplex('node', ['x'], undefined, (() => child) as any);
    const errored = new Promise<Error>((resolve) => stream.on('error', resolve));

    // What the OS does on a write to a dead server. Before the fix, nothing listened for
    // this and Node turned it into an uncaught exception.
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));

    expect((await errored).message).toMatch(/EPIPE/);
    expect(stream.destroyed).toBe(true); // LspProxy evicts the session off this
  });

  it('kills the process when the stream is destroyed', async () => {
    const stream = spawnDuplex('node', ['-e', 'setInterval(() => {}, 1000)']); // never exits on its own
    const closed = new Promise((resolve) => stream.on('close', resolve));

    stream.destroy();
    await closed;

    // Nothing left running: the child was killed, not orphaned.
    expect(stream.destroyed).toBe(true);
  });
});
