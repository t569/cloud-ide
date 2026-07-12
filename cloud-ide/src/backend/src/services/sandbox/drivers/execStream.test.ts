// Self-check for the in-container LSP transport. What can actually break here is
// the lifecycle: bytes must survive the round trip unmangled (a TTY would echo and
// rewrite newlines, corrupting Content-Length framing), a dead process must kill the
// stream (so LspProxy evicts the session instead of talking to a corpse), and a
// destroyed stream must kill the process (so a closed tab doesn't leak a server).
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

  it('kills the process when the stream is destroyed', async () => {
    const stream = spawnDuplex('node', ['-e', 'setInterval(() => {}, 1000)']); // never exits on its own
    const closed = new Promise((resolve) => stream.on('close', resolve));

    stream.destroy();
    await closed;

    // Nothing left running: the child was killed, not orphaned.
    expect(stream.destroyed).toBe(true);
  });
});
