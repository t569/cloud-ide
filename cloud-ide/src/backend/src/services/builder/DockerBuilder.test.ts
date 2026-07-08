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
