import { describe, it, expect, vi, afterEach } from 'vitest';
import { SseExecTransport } from './SseExecTransport';

// Mock the auth wrapper so we can inspect the exec payload and feed a fake SSE body.
vi.mock('../../lib/apiClient', () => ({ postStream: vi.fn() }));
import { postStream } from '../../lib/apiClient';

const mocked = postStream as unknown as ReturnType<typeof vi.fn>;

/** A Response whose body streams the given execd SSE lines, one chunk each. */
function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + '\n'));
      c.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

/** Drive one command through the transport and collect everything it emits. */
async function run(command: string, sseLines: string[]) {
  const t = new SseExecTransport('sbx-1');
  const out: string[] = [];
  t.onData((d) => out.push(d));
  mocked.mockResolvedValueOnce(sseResponse(sseLines));
  for (const ch of command) t.write(ch);
  t.write('\r'); // Enter → execute() (fire-and-forget; drain below)
  await new Promise((r) => setTimeout(r, 10));
  return { out, body: mocked.mock.calls.at(-1)?.[1]?.body };
}

describe('SseExecTransport.execute', () => {
  afterEach(() => mocked.mockReset());

  // The bug: the old payload was ['/bin/sh','-c', command]; the gateway join(' ')s the
  // array and execd runs it via `bash -c`, so wrapping produced a triple-shell that
  // syntax-errored and streamed nothing. execd supplies the shell — send it raw.
  it('sends the command as a single element (raw, not wrapped in /bin/sh -c), with TERM exported', async () => {
    const { body } = await run('ls -la', []);
    expect(body.command).toHaveLength(1);
    expect(body.command[0]).not.toContain('/bin/sh'); // no triple-shell
    expect(body.command[0]).toContain('ls -la'); // the raw command survives
    expect(body.command[0]).toContain('TERM='); // execd ignores env, so TERM is exported inline
  });

  // execd frames events as raw JSON lines (blank line between), NOT `data: ` SSE —
  // the old parser filtered on `data: ` and rendered nothing. Feed the real framing.
  it('renders raw-JSON stdout/stderr lines (no data: prefix) with a line break each', async () => {
    const { out } = await run('ls', [
      '{"type":"init","text":"abc"}',
      '',
      '{"type":"stdout","text":"file-a"}',
      '',
      '{"type":"stdout","text":"file-b"}',
      '',
      '{"type":"execution_complete"}',
    ]);
    // Both lines rendered, each terminated so xterm doesn't concatenate them.
    expect(out.join('')).toContain('file-a\r\n');
    expect(out.join('')).toContain('file-b\r\n');
  });
});
