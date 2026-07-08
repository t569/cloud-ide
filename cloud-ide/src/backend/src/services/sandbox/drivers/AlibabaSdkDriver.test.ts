// Self-check for the SDK→ISandboxSession adapter (the reviewable half of the
// unverified AlibabaSdkDriver). The live SDK connection is NOT tested here.
import { SdkSession, SdkPtyProcess } from './AlibabaSdkDriver';

function fakePty() {
  let exitCb: (code: number) => void = () => {};
  const pty: SdkPtyProcess & { stdin_: string[]; resizes: [number, number][]; killed: boolean; fireExit: (c: number) => void } = {
    stdin_: [],
    resizes: [],
    killed: false,
    sendStdin: (d) => pty.stdin_.push(d),
    resize: (c, r) => pty.resizes.push([c, r]),
    kill: () => { pty.killed = true; },
    onExit: (cb) => { exitCb = cb; },
    fireExit: (c) => exitCb(c),
  };
  return pty;
}

describe('SdkSession adapter', () => {
  it('maps write/resize/close onto the SDK process', () => {
    const pty = fakePty();
    const s = new SdkSession();
    s.attach(pty);

    s.write('echo hi\n');
    s.resize(100, 30);
    s.close();

    expect(pty.stdin_).toEqual(['echo hi\n']);
    expect(pty.resizes).toEqual([[100, 30]]);
    expect(pty.killed).toBe(true);
  });

  it('buffers output that arrives before a consumer attaches, then flushes', () => {
    const s = new SdkSession();
    s.attach(fakePty());

    s.pushOutput('early '); // no onData yet → buffered
    const got: string[] = [];
    s.onData((chunk) => got.push(chunk.toString()));
    s.pushOutput('late');   // onData set → immediate

    expect(got).toEqual(['early ', 'late']);
  });

  it('forwards the SDK process exit to onExit', () => {
    const pty = fakePty();
    const s = new SdkSession();
    s.attach(pty);

    const codes: number[] = [];
    s.onExit((c) => codes.push(c));
    pty.fireExit(0);

    expect(codes).toEqual([0]);
  });

  it('falls back to stdin.write when sendStdin is absent', () => {
    const written: string[] = [];
    const pty: SdkPtyProcess = { stdin: { write: (d) => written.push(d) }, kill: () => {} };
    const s = new SdkSession();
    s.attach(pty);

    s.write('x');
    expect(written).toEqual(['x']);
  });
});
