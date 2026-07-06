// Docker implementation of IBuilder. Spawns `docker build`, feeds the Dockerfile
// over stdin, and streams stdout+stderr. Owns the process lifecycle so it can be
// cancelled. (Supersedes the old static ExecutorService.)
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { IBuilder, BuildProcess } from './IBuilder';

class DockerBuildProcess extends EventEmitter implements BuildProcess {
  private child?: ChildProcess;
  private done = false;

  constructor(dockerfile: string, imageTags: string[]) {
    super();
    // Defer so the caller can attach listeners before the first emit.
    setImmediate(() => this.run(dockerfile, imageTags));
  }

  private settle(event: 'succeeded' | 'failed', message: string): void {
    if (this.done) return;
    this.done = true;
    this.emit(event, message);
  }

  private run(dockerfile: string, imageTags: string[]): void {
    try {
      this.emit('data', `Initializing Cloud IDE build pipeline for ${imageTags.join(', ')}...\n`);

      // '-' => read the Dockerfile from stdin. --progress=plain keeps logs clean.
      // One build, tagged with every ref (content hash + :latest).
      const tagArgs = imageTags.flatMap((t) => ['-t', t]);
      const child = spawn('docker', ['build', '--progress=plain', ...tagArgs, '-']);
      this.child = child;

      // Guard: a missing/broken docker binary emits 'error' on the child; without
      // this it becomes an unhandled exception that crashes the gateway.
      child.on('error', (err) =>
        this.settle('failed', `Failed to start Docker: ${err.message}. Is Docker installed and running on the host?`),
      );
      child.stdin.on('error', () => { /* swallow EPIPE when the spawn failed */ });

      child.stdin.write(dockerfile);
      child.stdin.end();

      child.stdout.on('data', (d) => this.emit('data', d.toString()));
      // BuildKit sends normal progress to stderr, so treat it as log data too.
      child.stderr.on('data', (d) => this.emit('data', d.toString()));

      child.on('close', (code) => {
        if (code === 0) this.settle('succeeded', `Build completed. Tagged as ${imageTags.join(', ')}`);
        else this.settle('failed', `Build failed with exit code ${code}`);
      });
    } catch (err: any) {
      this.settle('failed', `Pipeline error: ${err.message}`);
    }
  }

  cancel(): void {
    this.child?.kill('SIGTERM');
    this.settle('failed', 'Build cancelled');
  }
}

export class DockerBuilder implements IBuilder {
  readonly name = 'docker';

  build(dockerfile: string, imageTags: string[]): BuildProcess {
    return new DockerBuildProcess(dockerfile, imageTags);
  }

  /** `docker image inspect` — exit 0 means the image is already built locally. */
  exists(imageTag: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('docker', ['image', 'inspect', imageTag], { stdio: 'ignore' });
      child.on('error', () => resolve(false)); // docker missing -> treat as "not cached"
      child.on('close', (code) => resolve(code === 0));
    });
  }

  /** `docker tag` — point target at source (e.g. move :latest onto a content tag). */
  tag(source: string, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['tag', source, target], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`docker tag exited ${code}`))));
    });
  }
}
