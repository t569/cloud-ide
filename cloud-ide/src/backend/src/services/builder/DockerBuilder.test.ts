// Captures the argv DockerBuilder hands to DockerCli.stream, so the non-trivial
// bit — conditional --builder/--platform flags and their order — is pinned.
import { DockerBuilder } from './DockerBuilder';
import { DockerCli } from '../docker';

function fakeCli() {
  const calls: string[][] = [];
  const cli = {
    stream: (args: string[]) => {
      calls.push(args);
      return { on() {}, cancel() {} };
    },
  } as unknown as DockerCli;
  return { cli, calls };
}

describe('DockerBuilder build args', () => {
  it('omits --builder and --platform when neither is set', () => {
    const { cli, calls } = fakeCli();
    new DockerBuilder(cli, undefined).build('FROM x', ['img:1']);
    expect(calls[0]).toEqual(['build', '--progress=plain', '-t', 'img:1', '-']);
  });

  it('prepends --builder then --platform, tagging every ref', () => {
    const { cli, calls } = fakeCli();
    new DockerBuilder(cli, 'capped').build('FROM x', ['img:1', 'img:latest'], {
      platform: 'linux/arm64',
    });
    expect(calls[0]).toEqual([
      'build', '--builder', 'capped', '--platform', 'linux/arm64',
      '--progress=plain', '-t', 'img:1', '-t', 'img:latest', '-',
    ]);
  });
});

describe('DockerBuilder push args', () => {
  it('pushes exactly the given (registry-qualified) ref', () => {
    const { cli, calls } = fakeCli();
    new DockerBuilder(cli).push('reg.example.com/cloud-ide-env-x:abc123');
    expect(calls[0]).toEqual(['push', 'reg.example.com/cloud-ide-env-x:abc123']);
  });
});

describe('DockerBuilder.resolvable', () => {
  // succeedsLocal: `image inspect` result; runReject: what `manifest inspect` throws.
  function cli(succeedsLocal: boolean, runReject?: string) {
    return {
      succeeds: async () => succeedsLocal,
      run: async () => {
        if (runReject !== undefined) throw new Error(runReject);
        return { stdout: '', stderr: '' };
      },
    } as unknown as DockerCli;
  }

  it('true when present locally (no registry call)', async () => {
    expect(await new DockerBuilder(cli(true)).resolvable('python:22.04')).toBe(true);
  });

  it('true when the registry manifest resolves', async () => {
    expect(await new DockerBuilder(cli(false)).resolvable('python:3.12')).toBe(true);
  });

  it('false ONLY when the registry says the tag is unknown', async () => {
    const b = new DockerBuilder(cli(false, 'docker manifest inspect exited 1: no such manifest: docker.io/library/python:22.04'));
    expect(await b.resolvable('python:22.04')).toBe(false);
  });

  it('fails open on non-"not found" errors (offline / docker missing / auth)', async () => {
    const offline = new DockerBuilder(cli(false, 'spawn docker ENOENT'));
    expect(await offline.resolvable('python:3.12')).toBe(true);
    const authErr = new DockerBuilder(cli(false, 'error: denied: requested access to the resource is denied'));
    expect(await authErr.resolvable('private/img:1')).toBe(true);
  });
});
