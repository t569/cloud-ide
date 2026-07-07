// The single, injection-safe entry point for shelling out to the docker CLI.
// Every docker invocation in the backend goes through here, so they share one
// argv-based (no shell) spawn, one error convention, and one config knob.
import { spawn } from 'child_process';
import { DockerProcess, StreamOptions } from './DockerProcess';

export class DockerCli {
  // ponytail: the binary name is the calibration knob — swap 'docker' for
  // 'podman', an absolute path, or a remote-docker shim in one place; no caller
  // changes. A second CLI *backend* (different arg grammar) would justify an
  // IDockerCli interface — not needed until then.
  constructor(private readonly bin = 'docker') {}

  /** Run a one-shot command; resolves with output, REJECTS on non-zero exit.
   *  For commands where a non-zero exit is a real failure (tag, prune). */
  run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(new Error(`${this.bin} ${args.join(' ')} exited ${code}: ${stderr.trim()}`)),
      );
    });
  }

  /** True iff the command exits 0; never throws (a spawn error → false). For
   *  probes like `image inspect`, where non-zero means "no", not an error. */
  succeeds(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, args, { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }

  /** Start a streaming command (e.g. `build`); returns a cancellable handle. */
  stream(args: string[], opts?: StreamOptions): DockerProcess {
    return new DockerProcess(this.bin, args, opts);
  }
}
