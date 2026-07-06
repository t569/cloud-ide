// Docker implementation of IBuilder. Spawns `docker build`, feeds the Dockerfile
// over stdin, and streams stdout+stderr. Owns the process lifecycle so it can be
// cancelled. (Supersedes the old static ExecutorService.)
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { IBuilder, BuildProcess } from './IBuilder';

class DockerBuildProcess extends EventEmitter implements BuildProcess {
  private child?: ChildProcess;
  private done = false;

  constructor(dockerfile: string, imageTag: string) {
    super();
    // Defer so the caller can attach listeners before the first emit.
    setImmediate(() => this.run(dockerfile, imageTag));
  }

  private settle(event: 'succeeded' | 'failed', message: string): void {
    if (this.done) return;
    this.done = true;
    this.emit(event, message);
  }

  private run(dockerfile: string, imageTag: string): void {
    try {
      this.emit('data', `Initializing Cloud IDE build pipeline for ${imageTag}...\n`);

      // '-' => read the Dockerfile from stdin. --progress=plain keeps logs clean.
      const child = spawn('docker', ['build', '--progress=plain', '-t', imageTag, '-']);
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
        if (code === 0) this.settle('succeeded', `Build completed. Tagged as ${imageTag}`);
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
  build(dockerfile: string, imageTag: string): BuildProcess {
    return new DockerBuildProcess(dockerfile, imageTag);
  }
}
