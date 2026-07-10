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
  it('sends the raw command as a single element, not wrapped in /bin/sh -c', async () => {
    const { body } = await run('ls -la', []);
    expect(body.command).toEqual(['ls -la']);
    expect(body.command).not.toContain('/bin/sh');
  });

  it('streams stdout/stderr events from the SSE body into the terminal', async () => {
    const { out } = await run('echo hi', [
      'data: {"type":"stdout","text":"hi"}',
      'data: {"type":"execution_complete"}',
    ]);
    expect(out.join('')).toContain('hi');
  });
});
