// Guards the security-relevant bit of DockerPtyDriver: the `docker exec` argv is
// built as an ARRAY (never a shell string) with the sandboxId only ever inside the
// `sandbox-<id>` container name — so an id can't inject a flag or command. node-pty
// is virtual-mocked so this runs without the native module installed.
jest.mock('node-pty', () => ({ spawn: jest.fn(() => fakePtyProc()) }), { virtual: true });

import { DockerPtyDriver, DockerPtySession } from './DockerPtyDriver';
import { ISandboxDriver } from './ISandboxDriver';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty = require('node-pty');

function fakePtyProc() {
  return {
    onData: jest.fn(),
    onExit: jest.fn(),
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
  };
}

const base = { capabilities: () => ({ exec: true, pty: false }) } as unknown as ISandboxDriver;

beforeEach(() => (pty.spawn as jest.Mock).mockClear());

describe('DockerPtyDriver.openSession', () => {
  it('spawns `docker exec -it` with array args and the id only in the container name', async () => {
    const driver = new DockerPtyDriver(base);
    await driver.openSession('abc-123', { cols: 120, rows: 40 });

    expect(pty.spawn).toHaveBeenCalledTimes(1);
    const [file, args, opts] = (pty.spawn as jest.Mock).mock.calls[0];
    expect(file).toBe('docker');
    expect(args).toEqual([
      'exec', '-it',
      '-e', 'TERM=xterm-256color',
      '-w', '/workspace',
      'sandbox-abc-123',
      'bash',
    ]);
    expect(opts).toMatchObject({ cols: 120, rows: 40, name: 'xterm-256color' });
  });

  it('advertises pty:true when node-pty loads, preserving the base exec flag', () => {
    expect(new DockerPtyDriver(base).capabilities()).toEqual({ exec: true, pty: true });
  });
});

describe('DockerPtySession', () => {
  it('maps write/resize/close and Buffers onData onto the node-pty process', () => {
    const proc = fakePtyProc();
    const s = new DockerPtySession(proc as any);

    s.write('ls\r');
    s.resize(90, 25);
    s.close();
    const onData = jest.fn();
    s.onData(onData);
    (proc.onData as jest.Mock).mock.calls[0][0]('hello'); // node-pty emits a string

    expect(proc.write).toHaveBeenCalledWith('ls\r');
    expect(proc.resize).toHaveBeenCalledWith(90, 25);
    expect(proc.kill).toHaveBeenCalled();
    expect(onData).toHaveBeenCalledWith(Buffer.from('hello', 'utf8'));
  });
});
