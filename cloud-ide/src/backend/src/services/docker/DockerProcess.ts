// A running CLI command that streams its output. Deliberately emits
// 'succeeded'/'failed' — NOT Node's reserved 'error' event, whose
// missing-listener throw is a footgun. Contract:
//   'data'      (chunk: string)   — a stdout/stderr chunk
//   'succeeded' (message: string)
//   'failed'    (message: string)
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface StreamOptions {
  /** Written to the child's stdin, then stdin is closed (e.g. a Dockerfile). */
  stdin?: string;
  /** A line emitted as 'data' before the process starts (a heading/banner). */
  banner?: string;
  /** Map the exit code to an outcome + message. Default: ok iff code === 0. */
  onExit?: (code: number | null) => { ok: boolean; message: string };
  /** Message emitted as 'failed' when the binary itself can't be spawned. */
  onSpawnError?: (err: Error) => string;
  /** Message emitted as 'failed' when cancel() is called. Default 'Cancelled'. */
  cancelMessage?: string;
}

export class DockerProcess extends EventEmitter {
  private child?: ChildProcess;
  private done = false;
  private readonly cancelMessage: string;

  constructor(bin: string, args: string[], opts: StreamOptions = {}) {
    super();
    this.cancelMessage = opts.cancelMessage ?? 'Cancelled';
    // Defer so the caller can attach listeners before the first emit.
    setImmediate(() => this.run(bin, args, opts));
  }

  private settle(event: 'succeeded' | 'failed', message: string): void {
    if (this.done) return;
    this.done = true;
    this.emit(event, message);
  }

  private run(bin: string, args: string[], opts: StreamOptions): void {
    try {
      if (opts.banner) this.emit('data', opts.banner);

      const child = spawn(bin, args);
      this.child = child;

      // A missing/broken binary emits 'error' on the child; convert it to a clean
      // 'failed' so it can't become an unhandled exception that crashes the host.
      child.on('error', (err) =>
        this.settle(
          'failed',
          opts.onSpawnError ? opts.onSpawnError(err) : `Failed to start ${bin}: ${err.message}`,
        ),
      );

      if (opts.stdin !== undefined && child.stdin) {
        child.stdin.on('error', () => { /* swallow EPIPE when the spawn failed */ });
        child.stdin.write(opts.stdin);
        child.stdin.end();
      }

      child.stdout?.on('data', (d) => this.emit('data', d.toString()));
      // Many tools (BuildKit) send normal progress to stderr — treat as log data.
      child.stderr?.on('data', (d) => this.emit('data', d.toString()));

      child.on('close', (code) => {
        const outcome = opts.onExit
          ? opts.onExit(code)
          : { ok: code === 0, message: code === 0 ? 'Done' : `Exited with code ${code}` };
        this.settle(outcome.ok ? 'succeeded' : 'failed', outcome.message);
      });
    } catch (err) {
      this.settle('failed', `${bin} error: ${(err as Error).message}`);
    }
  }

  /** Best-effort abort of the underlying process. */
  cancel(): void {
    this.child?.kill('SIGTERM');
    this.settle('failed', this.cancelMessage);
  }
}
