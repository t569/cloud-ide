// Uses `node` as a deterministic stand-in for `docker` (the binary is the config
// knob), so the check runs anywhere without Docker installed.
import { DockerCli } from './DockerCli';

describe('DockerCli', () => {
  const cli = new DockerCli('node');

  it('run() resolves and captures stdout on exit 0', async () => {
    const { stdout } = await cli.run(['-e', "process.stdout.write('hi')"]);
    expect(stdout).toBe('hi');
  });

  it('run() rejects on non-zero exit', async () => {
    await expect(cli.run(['-e', 'process.exit(3)'])).rejects.toThrow(/exited 3/);
  });

  it('succeeds() maps exit code to boolean and never throws', async () => {
    await expect(cli.succeeds(['-e', 'process.exit(0)'])).resolves.toBe(true);
    await expect(cli.succeeds(['-e', 'process.exit(1)'])).resolves.toBe(false);
    await expect(new DockerCli('no-such-binary-xyz').succeeds(['x'])).resolves.toBe(false);
  });

  it('stream() emits banner + data, then succeeded via onExit', async () => {
    const proc = cli.stream(['-e', "process.stdout.write('line')"], {
      banner: 'BANNER\n',
      onExit: (code) => (code === 0 ? { ok: true, message: 'ok!' } : { ok: false, message: 'bad' }),
    });
    const chunks: string[] = [];
    const outcome = await new Promise<string>((resolve) => {
      proc.on('data', (d) => chunks.push(d));
      proc.on('succeeded', (m) => resolve(m));
      proc.on('failed', (m) => resolve('FAILED:' + m));
    });
    expect(outcome).toBe('ok!');
    expect(chunks.join('')).toContain('BANNER');
    expect(chunks.join('')).toContain('line');
  });

  it('stream() cancel() settles as failed with the cancel message', async () => {
    const proc = cli.stream(['-e', 'setTimeout(() => {}, 10000)'], { cancelMessage: 'Build cancelled' });
    const outcome = await new Promise<string>((resolve) => {
      proc.on('succeeded', () => resolve('succeeded'));
      proc.on('failed', (m) => resolve(m));
      setTimeout(() => proc.cancel(), 100);
    });
    expect(outcome).toBe('Build cancelled');
  });
});
