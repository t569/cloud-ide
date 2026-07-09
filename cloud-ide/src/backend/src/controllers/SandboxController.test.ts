// Regression guard for the exec self-abort.
//
// `req.on('close')` does NOT mean "the client went away". Since Node 16,
// IncomingMessage emits 'close' once the REQUEST has been fully read — and
// express.json() drains the body before the handler runs. Wiring the outbound
// AbortController to it aborted every single exec with "The operation was
// aborted". Only `res` closing early means the client is gone.
import { EventEmitter } from 'node:events';
import { SandboxController } from './SandboxController';

function fakeReq() {
  const req = new EventEmitter() as any;
  req.params = { sandboxId: 'sbx-1' };
  req.body = { command: ['/bin/sh', '-c', 'echo hi'], cwd: '/workspace' };
  req.userId = 'user-1';
  return req;
}

function fakeRes() {
  const res = new EventEmitter() as any;
  res.statusCode = 0;
  res.headersSent = false;
  res.writableFinished = false;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = () => res;
  res.setHeader = () => res;
  res.flushHeaders = () => {};
  res.end = () => {};
  return res;
}

function fakeManager() {
  return {
    getStatus: jest.fn().mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' }),
    resume: jest.fn(),
    resolveExecConnection: jest.fn().mockResolvedValue({
      baseUrl: 'http://execd.internal',
      accessToken: null,
    }),
  } as any;
}

describe('SandboxController.execCommand — abort wiring', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  /** Runs the handler far enough to capture the AbortSignal handed to fetch. */
  async function captureSignal() {
    let signal!: AbortSignal;
    let release!: () => void;
    const reachedFetch = new Promise<void>((r) => (release = r));

    global.fetch = jest.fn(async (_url: any, init: any) => {
      signal = init.signal;
      release();
      // Never resolve: hold the stream open like a live exec would.
      return new Promise(() => {}) as any;
    }) as any;

    const req = fakeReq();
    const res = fakeRes();
    void new SandboxController(fakeManager()).execCommand(req, res);
    await reachedFetch;
    return { req, res, signal };
  }

  it('does NOT abort when req emits close (body fully read, client still here)', async () => {
    const { req, signal } = await captureSignal();

    req.emit('close'); // express.json() finished draining the body
    await Promise.resolve();

    expect(signal.aborted).toBe(false);
  });

  it('aborts when the client disconnects before the response finishes', async () => {
    const { res, signal } = await captureSignal();

    res.writableFinished = false;
    res.emit('close');
    await Promise.resolve();

    expect(signal.aborted).toBe(true);
  });

  it('does NOT abort on a normally completed response', async () => {
    const { res, signal } = await captureSignal();

    res.writableFinished = true; // we called end() ourselves
    res.emit('close');
    await Promise.resolve();

    expect(signal.aborted).toBe(false);
  });
});
