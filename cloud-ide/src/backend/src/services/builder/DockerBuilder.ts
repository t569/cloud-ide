// Docker implementation of IBuilder. Every docker invocation goes through the
// shared DockerCli (argv-based spawn, one error convention), so this file just
// maps IBuilder operations onto docker subcommands.
import { IBuilder, BuildProcess } from './IBuilder';
import { DockerCli } from '../docker';

export class DockerBuilder implements IBuilder {
  readonly name = 'docker';

  // Default instance for prod; inject a DockerCli (real or fake) for tests or a
  // different binary/host.
  constructor(private readonly docker = new DockerCli()) {}

  build(dockerfile: string, imageTags: string[]): BuildProcess {
    // '-' => read the Dockerfile from stdin. --progress=plain keeps logs clean.
    // One build, tagged with every ref (content hash + :latest).
    const tagArgs = imageTags.flatMap((t) => ['-t', t]);
    return this.docker.stream(['build', '--progress=plain', ...tagArgs, '-'], {
      stdin: dockerfile,
      banner: `Initializing Cloud IDE build pipeline for ${imageTags.join(', ')}...\n`,
      onExit: (code) =>
        code === 0
          ? { ok: true, message: `Build completed. Tagged as ${imageTags.join(', ')}` }
          : { ok: false, message: `Build failed with exit code ${code}` },
      onSpawnError: (err) =>
        `Failed to start Docker: ${err.message}. Is Docker installed and running on the host?`,
      cancelMessage: 'Build cancelled',
    });
  }

  /** `docker image inspect` — exit 0 means the image is already built locally. */
  exists(imageTag: string): Promise<boolean> {
    return this.docker.succeeds(['image', 'inspect', imageTag]);
  }

  /** `docker tag` — point target at source (move :latest onto a content tag). */
  async tag(source: string, target: string): Promise<void> {
    await this.docker.run(['tag', source, target]);
  }
}
