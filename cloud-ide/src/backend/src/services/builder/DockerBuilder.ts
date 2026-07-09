// Docker implementation of IBuilder. Every docker invocation goes through the
// shared DockerCli (argv-based spawn, one error convention), so this file just
// maps IBuilder operations onto docker subcommands.
import { IBuilder, BuildProcess, BuildOptions } from './IBuilder';
import { DockerCli } from '../docker';

export class DockerBuilder implements IBuilder {
  readonly name = 'docker';

  // Default instance for prod; inject a DockerCli (real or fake) for tests or a
  // different binary/host. `buildxBuilder` targets a named buildx builder
  // instance ($DOCKER_BUILDER) — the scalable seam for resource limits: ops
  // provision `docker buildx create --name capped --driver-opt memory=..,cpus=..`
  // once, and every build is capped natively with BuildKit caching intact. Unset
  // => the default builder. No per-build --memory/--cpus (BuildKit ignores them).
  constructor(
    private readonly docker = new DockerCli(),
    private readonly buildxBuilder = process.env.DOCKER_BUILDER || undefined,
  ) {}

  build(dockerfile: string, imageTags: string[], opts: BuildOptions = {}): BuildProcess {
    // '-' => read the Dockerfile from stdin. --progress=plain keeps logs clean.
    // One build, tagged with every ref (content hash + :latest).
    const tagArgs = imageTags.flatMap((t) => ['-t', t]);
    const builderArgs = this.buildxBuilder ? ['--builder', this.buildxBuilder] : [];
    const platformArgs = opts.platform ? ['--platform', opts.platform] : [];
    return this.docker.stream(
      ['build', ...builderArgs, ...platformArgs, '--progress=plain', ...tagArgs, '-'],
      {
        stdin: dockerfile,
        banner: `Initializing Cloud IDE build pipeline for ${imageTags.join(', ')}...\n`,
        timeoutMs: opts.timeoutMs,
        timeoutMessage: `Build exceeded its ${opts.timeoutMs ? Math.round(opts.timeoutMs / 1000) : 0}s time limit and was aborted`,
        onExit: (code) =>
          code === 0
            ? { ok: true, message: `Build completed. Tagged as ${imageTags.join(', ')}` }
            : { ok: false, message: `Build failed with exit code ${code}` },
        onSpawnError: (err) =>
          `Failed to start Docker: ${err.message}. Is Docker installed and running on the host?`,
        cancelMessage: 'Build cancelled',
      },
    );
  }

  /** `docker image inspect` — exit 0 means the image is already built locally. */
  exists(imageTag: string): Promise<boolean> {
    return this.docker.succeeds(['image', 'inspect', imageTag]);
  }

  /**
   * Can this base image be pulled? Local first (works offline), else ask the
   * registry via `docker manifest inspect` (metadata only, no pull). Fails OPEN:
   * only a registry "unknown manifest/tag" returns false — spawn errors, auth,
   * offline, or a disabled `manifest` subcommand return true so `docker build`
   * stays the arbiter. Catches typo'd tags (e.g. python:22.04) before the build.
   */
  async resolvable(imageRef: string): Promise<boolean> {
    if (await this.docker.succeeds(['image', 'inspect', imageRef])) return true;
    try {
      await this.docker.run(['manifest', 'inspect', imageRef]);
      return true;
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      const unknown = /manifest unknown|manifest for .* not found|no such manifest|not found|does not exist|repository .* not found/.test(msg);
      return !unknown; // unknown tag -> block; any other failure -> fail open
    }
  }

  /** `docker tag` — point target at source (move :latest onto a content tag). */
  async tag(source: string, target: string): Promise<void> {
    await this.docker.run(['tag', source, target]);
  }

  /** `docker push` — ship a built (registry-qualified) ref to its registry. */
  push(imageTag: string): BuildProcess {
    return this.docker.stream(['push', imageTag], {
      banner: `Pushing ${imageTag} to registry...\n`,
      onExit: (code) =>
        code === 0
          ? { ok: true, message: `Pushed ${imageTag}` }
          : { ok: false, message: `Push failed with exit code ${code}` },
      onSpawnError: (err) =>
        `Failed to start Docker: ${err.message}. Is Docker installed and running on the host?`,
      cancelMessage: 'Push cancelled',
    });
  }
}
