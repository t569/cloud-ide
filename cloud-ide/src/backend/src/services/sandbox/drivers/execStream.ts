// backend/src/services/sandbox/drivers/execStream.ts
//
// A child process as a Duplex: write -> stdin, stdout -> read. This is the
// transport an in-container language server speaks over (see LspProxy's `exec`
// server kind), and the shape ISandboxDriver.openExecStream returns.
//
// Deliberately NOT a PTY. node-pty gives DockerPtyDriver a real TTY because vim
// and line-editing need one, but a TTY's line discipline echoes stdin back and
// rewrites \n as \r\n — which would corrupt Content-Length framing and hand the
// server its own bytes back. LSP wants raw pipes, so this uses plain stdio.
//
// ponytail: hand-rolled rather than `Duplex.from({readable, writable})`. That
// one-liner composes the streams but destroy() on it raises an AbortError instead
// of emitting a clean 'close' — and 'close' is exactly the signal LspProxy evicts a
// dead session on. The explicit version below is longer and has the semantics we
// actually depend on.
import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';

/**
 * Spawn `bin args...` and expose its stdio as one Duplex.
 *
 * argv, never a shell string — nothing here is interpolated into a shell.
 * stderr is the server's log channel (not protocol), so it is drained via
 * `onStderr`: left unread, a chatty server fills the pipe buffer and hangs.
 *
 * The child and the stream die together, both ways:
 *   - process exits/crashes -> stream is destroyed (LspSession fails its pending
 *     requests; LspProxy drops the session so the next request reconnects).
 *   - stream is destroyed    -> process is killed (a closed tab or a torn-down
 *     sandbox can't leak a language server).
 */
export function spawnDuplex(bin: string, args: string[], onStderr?: (line: string) => void): Duplex {
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  const stream = new Duplex({
    write(chunk, _enc, cb) {
      child.stdin.write(chunk, cb);
    },
    read() {
      // Resume after backpressure (see the push() below). A big completion list
      // must not be buffered without bound just because the consumer is slow.
      child.stdout.resume();
    },
    destroy(err, cb) {
      if (child.exitCode === null) child.kill();
      cb(err);
    },
  });

  child.stdout.on('data', (chunk: Buffer) => {
    if (!stream.push(chunk)) child.stdout.pause();
  });
  child.stdout.on('end', () => stream.push(null));

  child.stderr.on('data', (b: Buffer) => onStderr?.(b.toString('utf8').trimEnd()));

  child.on('error', (err) => stream.destroy(err));
  child.on('exit', (code, signal) => {
    const err =
      code === 0 || code === null
        ? undefined
        : new Error(`${bin} exited with code ${code}${signal ? ` (${signal})` : ''}`);
    // setImmediate so any final stdout chunk lands before we tear the stream down.
    setImmediate(() => stream.destroy(err));
  });

  return stream;
}
