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

describe('PtyRegistry — shells outlive sockets', () => {
  it('reattaches to the same shell and replays output buffered while detached', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    let creates = 0;
    const open = async () => { creates++; return session; };

    const ws1 = fakeSocket();
    await reg.attach('sbx t1', ws1, open);
    expect(creates).toBe(1);

    ws1.fire('close', 1006); // socket dropped
    expect(reg.size).toBe(1);        // shell kept alive
    expect(session.closed).toBe(false);

    session.emitData('while-detached'); // buffered, not sent to the dead socket
    expect(ws1.sent.length).toBe(0);

    const ws2 = fakeSocket();
    await reg.attach('sbx t1', ws2, open);
    expect(creates).toBe(1);          // reattached — NO new shell
    expect(ws2.sent[0]).toEqual({ data: Buffer.from('while-detached'), binary: true }); // replayed

    session.emitData('live-again');
    expect(ws2.sent[1]).toEqual({ data: Buffer.from('live-again'), binary: true });
  });

  it('closing the terminal tab (clean 1000) keeps the shell alive — a dev server survives', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    const ws1 = fakeSocket();
    let creates = 0;
    const open = async () => { creates++; return session; };
    await reg.attach('sbx t1', ws1, open);

    ws1.fire('close', 1000); // user closed the tab
    expect(session.closed).toBe(false); // NOT killed — the dev server keeps running
    expect(reg.size).toBe(1);

    // Reopening the terminal reattaches to the same live shell.
    const ws2 = fakeSocket();
    await reg.attach('sbx t1', ws2, open);
    expect(creates).toBe(1);
  });

  it('the deliberate kill path: the shell process exiting reclaims it', async () => {
    const reg = new PtyRegistry();
    const session = fakeSession();
    const ws = fakeSocket();
    await reg.attach('sbx t1', ws, async () => session);

    session.emitExit(0); // `exit` / Ctrl-D
    expect(reg.size).toBe(0);
  });

  it('caps detached shells per sandbox, evicting the oldest detached one', async () => {
    const reg = new PtyRegistry(2); // cap of 2 for the test
    const s = () => fakeSession();
    const sessions = [s(), s(), s()];

    // Two terminals for the sandbox, both detached (oldest = t1).
    const ws1 = fakeSocket(); await reg.attach('sbx t1', ws1, async () => sessions[0]); ws1.fire('close');
    const ws2 = fakeSocket(); await reg.attach('sbx t2', ws2, async () => sessions[1]); ws2.fire('close');
    expect(reg.size).toBe(2);

    // A third pushes over the cap → the oldest detached (t1) is evicted.
    const ws3 = fakeSocket(); await reg.attach('sbx t3', ws3, async () => sessions[2]);
    expect(reg.size).toBe(2);
    expect(sessions[0].closed).toBe(true);  // t1 reaped
    expect(sessions[1].closed).toBe(false); // t2 survives
    expect(sessions[2].closed).toBe(false); // t3 is the active one
  });

  it('never evicts an ATTACHED (active) terminal to make room', async () => {
    const reg = new PtyRegistry(1); // cap of 1
    const active = fakeSession();
    const wsA = fakeSocket(); await reg.attach('sbx t1', wsA, async () => active); // stays attached

    const other = fakeSession();
    const wsB = fakeSocket(); await reg.attach('sbx t2', wsB, async () => other);
    // Over cap, but t1 is active and t2 is active — nothing detached to evict, so both stay.
    expect(reg.size).toBe(2);
    expect(active.closed).toBe(false);
  });

  it('scopes the cap per sandbox — a busy sandbox never evicts another sandbox’s shells', async () => {
    const reg = new PtyRegistry(1);
    const a = fakeSession(); const b = fakeSession();
    const wsA = fakeSocket(); await reg.attach('sbxA t1', wsA, async () => a); wsA.fire('close');
    const wsB = fakeSocket(); await reg.attach('sbxB t1', wsB, async () => b); wsB.fire('close');
    // Each sandbox has 1 (its cap); neither evicts the other.
    expect(reg.size).toBe(2);
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
  });
});
