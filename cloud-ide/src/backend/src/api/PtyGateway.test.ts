// Self-check for the WS↔session bridge: the frame-type protocol and lifecycle.
import { bridgeSession, PtySocket } from './PtyGateway';
import { ISandboxSession } from '../services/sandbox/drivers/ISandboxDriver';

// Fake ws socket: records sends/closes, lets the test fire its 'on' handlers.
function fakeSocket() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const sent: Array<{ data: string | Buffer; binary?: boolean }> = [];
  const socket: PtySocket & { sent: typeof sent; fire: (e: string, ...a: any[]) => void; closed: boolean } = {
    readyState: 1, // WebSocket.OPEN
    sent,
    closed: false,
    send: (data, opts) => sent.push({ data, binary: opts?.binary }),
    close: () => { (socket as any).closed = true; },
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

describe('bridgeSession', () => {
  it('binary frame → session stdin; text resize frame → session.resize', () => {
    const ws = fakeSocket();
    const session = fakeSession();
    bridgeSession(ws, session);

    ws.fire('message', Buffer.from('ls -la\n'), true);                       // binary = stdin
    ws.fire('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 120, rows: 40 })), false);

    expect(session.writes).toEqual(['ls -la\n']);
    expect(session.resizes).toEqual([[120, 40]]);
  });

  it('ignores malformed / unknown text control frames', () => {
    const ws = fakeSocket();
    const session = fakeSession();
    bridgeSession(ws, session);

    ws.fire('message', Buffer.from('not json'), false);
    ws.fire('message', Buffer.from(JSON.stringify({ type: 'nope' })), false);

    expect(session.writes).toEqual([]);
    expect(session.resizes).toEqual([]);
  });

  it('session output → binary WS frame; exit → text frame then close', () => {
    const ws = fakeSocket();
    const session = fakeSession();
    bridgeSession(ws, session);

    session.emitData('hello');
    session.emitExit(0);

    expect(ws.sent[0]).toEqual({ data: Buffer.from('hello'), binary: true });
    expect(ws.sent[1]).toEqual({ data: JSON.stringify({ type: 'exit', code: 0 }), binary: undefined });
    expect(ws.closed).toBe(true);
  });

  it('closing the socket closes the session', () => {
    const ws = fakeSocket();
    const session = fakeSession();
    bridgeSession(ws, session);

    ws.fire('close');
    expect(session.closed).toBe(true);
  });
});
