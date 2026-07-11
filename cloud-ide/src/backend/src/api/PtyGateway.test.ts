// Self-check for PtyRegistry: the WS↔session frame protocol AND the reattach
// lifecycle (drop → buffer → reconnect → replay; clean-close and grace reaping).
import { PtyRegistry, PtySocket } from './PtyGateway';
import { ISandboxSession } from '../services/sandbox/drivers/ISandboxDriver';

// Fake ws socket: records sends/closes, lets the test fire its 'on' handlers.
function fakeSocket() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const sent: Array<{ data: string | Buffer; binary?: boolean }> = [];
  const socket: PtySocket & {
    sent: typeof sent; fire: (e: string, ...a: any[]) => void; closed: boolean; closeCode?: number;
    readyState: number;
  } = {
    readyState: 1, // WebSocket.OPEN
    sent,
    closed: false,
    send: (data, opts) => sent.push({ data, binary: opts?.binary }),
    close: (code?: number) => { socket.closed = true; socket.closeCode = code; socket.readyState = 3; },
    on: (event, listener) => { handlers[event] = listener; },
    fire: (event, ...args) => handlers[event]?.(...args),
  };
  return socket;
}

// Fake sandbox session: records I/O, lets the test push data/exit outward.
function fakeSession() {
  let dataCb: (c: Buffer) => void = () => {};
  let exitCb: (code: number) => void = () => {};
  const session: ISandboxSession & { writes: string[]; resizes: [number, number][]; closed: boolean;
    emitData: (s: string) => void; emitExit: (code: number) => void } = {
    writes: [],
    resizes: [],
    closed: false,
    onData: (cb) => { dataCb = cb; },
    onExit: (cb) => { exitCb = cb; },
    write: (d) => session.writes.push(d),
    resize: (c, r) => session.resizes.push([c, r]),
    close: () => { session.closed = true; },
    emitData: (s) => dataCb(Buffer.from(s)),
    emitExit: (code) => exitCb(code),
  };
  return session;
}

describe('PtyRegistry — frame protocol', () => {
  it('binary frame → session stdin; text resize frame → session.resize', async () => {
    const reg = new PtyRegistry();
    const ws = fakeSocket();
    const session = fakeSession();
    await reg.attach('k', ws, async () => session);

    ws.fire('message', Buffer.from('ls -la\n'), true);
    ws.fire('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 120, rows: 40 })), false);

    expect(session.writes).toEqual(['ls -la\n']);
    expect(session.resizes).toEqual([[120, 40]]);
  });

  it('ignores malformed / unknown text control frames', async () => {
    const reg = new PtyRegistry();
    const ws = fakeSocket();
    const session = fakeSession();
    await reg.attach('k', ws, async () => session);

    ws.fire('message', Buffer.from('not json'), false);
    ws.fire('message', Buffer.from(JSON.stringify({ type: 'nope' })), false);

    expect(session.writes).toEqual([]);
    expect(session.resizes).toEqual([]);
  });

  it('session output → binary WS frame; exit → text frame, close, and reclaim', async () => {
    const reg = new PtyRegistry();
    const ws = fakeSocket();
    const session = fakeSession();
    await reg.attach('k', ws, async () => session);

    session.emitData('hello');
    session.emitExit(0);

    expect(ws.sent[0]).toEqual({ data: Buffer.from('hello'), binary: true });
    expect(ws.sent[1]).toEqual({ data: JSON.stringify({ type: 'exit', code: 0 }), binary: undefined });
    expect(ws.closed).toBe(true);
    expect(session.closed).toBe(false); // shell exited on its own — we don't re-close it
    expect(reg.size).toBe(0);
  });
});

describe('PtyRegistry — reattach across drops', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reattaches to the same shell and replays output buffered while detached', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    let creates = 0;
    const open = async () => { creates++; return session; };

    const ws1 = fakeSocket();
    await reg.attach('k', ws1, open);
    expect(creates).toBe(1);

    ws1.fire('close', 1006); // abnormal drop
    expect(reg.size).toBe(1);        // shell kept alive
    expect(session.closed).toBe(false);

    session.emitData('while-detached'); // buffered, not sent to the dead socket
    expect(ws1.sent.length).toBe(0);

    const ws2 = fakeSocket();
    await reg.attach('k', ws2, open);
    expect(creates).toBe(1);          // reattached — NO new shell
    expect(ws2.sent[0]).toEqual({ data: Buffer.from('while-detached'), binary: true }); // replayed

    session.emitData('live-again');
    expect(ws2.sent[1]).toEqual({ data: Buffer.from('live-again'), binary: true });

    jest.advanceTimersByTime(120_000); // grace was cancelled on reattach
    expect(session.closed).toBe(false);
    expect(reg.size).toBe(1);
  });

  it('a clean close (tab closed, 1000) reclaims the shell immediately', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    const ws = fakeSocket();
    await reg.attach('k', ws, async () => session);

    ws.fire('close', 1000);
    expect(session.closed).toBe(true);
    expect(reg.size).toBe(0);
  });

  it('an abnormal drop with no reconnect is reaped after the grace period', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    const ws = fakeSocket();
    await reg.attach('k', ws, async () => session);

    ws.fire('close', 1006);
    expect(reg.size).toBe(1);         // still alive during grace
    jest.advanceTimersByTime(60_000);
    expect(session.closed).toBe(true); // reaped
    expect(reg.size).toBe(0);
  });
});
