// backend/src/services/sandbox/drivers/wasm/WasmDriver.ts
//
// Phase 1 of the WASM sandbox tier (docs/plans/wasm-runtime.md): the same backend, with
// sandbox execution swapped from Docker containers to WASM modules, so the product can
// deploy on hosting that has no Docker daemon at all.
//
// Selected by SANDBOX_DRIVER=wasm. Everything outside this file is unchanged — in
// particular STORAGE does not move: WASI preopens hand a module a real host directory, so
// the sandbox's git worktree is mounted by naming it as a preopen instead of a bind mount.
// WorktreeEngine, the git surface, /api/fs and the cache volumes all keep working.
//
// The runtime is `node:wasi` — built into Node, so this tier adds NO dependency. It is
// preview1: no sockets, no threads, one module per process. Those limits are exactly the
// phase-1 boundary, so nothing here works around them; wasmtime (sockets → resolveEndpoint)
// and Wasmer/WASIX (fork/exec → a real PTY) are the documented upgrades.
//
// ponytail: one child process per exec rather than an in-process instance pool. wasi.start()
// is synchronous and would block the event loop for as long as the guest runs, which for a
// dev sandbox is fatal. A child also gives free streaming, free kill, and OS-level memory
// bounds. The cost is per-EXEC (~30 MB while running), not per-sandbox: an idle sandbox is a
// map entry. Move to a worker pool if exec latency ever shows up in a profile.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { Duplex } from 'node:stream';
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxState,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { DriverCapabilities, ISandboxDriver } from '../ISandboxDriver';
import { ExecConnectionInfo, SandboxEndpoint } from '../../../../types/engine';
import { dataPath } from '../../../../config/paths';
import { spawnDuplex } from '../execStream';
import { WasmExecdShim } from './wasmExecdShim';

/**
 * The guest program, run by `node -e`. Inline rather than a sibling .js file so there is
 * no build-output copying step to get wrong — dev (ts-node) and prod (dist) behave the same.
 *
 * argv under `-e` is [execPath, ...args] — no script slot — hence slice(1).
 * returnOnExit makes wasi.start() hand back the guest's exit code instead of killing us.
 */
const RUNNER = `
const { WASI } = require('node:wasi');
const fs = require('node:fs');
const [modulePath, preopens, env, ...args] = process.argv.slice(1);
const wasi = new WASI({
  version: 'preview1',
  args,
  env: JSON.parse(env),
  preopens: JSON.parse(preopens),
  returnOnExit: true,
});
WebAssembly.compile(fs.readFileSync(modulePath))
  .then((m) => WebAssembly.instantiate(m, wasi.getImportObject()))
  .then((i) => { process.exitCode = wasi.start(i); })
  .catch((e) => {
    process.stderr.write(String((e && e.message) || e) + '\\n');
    process.exitCode = 1;
  });
`;

/**
 * One path segment: an imageTag or a program name, used to build a path. Anchored and
 * free of separators, so a validated value cannot traverse — `..` fails the first char
 * class, and `/`, `\` and `:` are not in the set at all.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Where an environment's modules live. One directory per imageTag IS the "image". */
export const WASM_MODULES_ROOT = process.env.WASM_MODULES_ROOT
  ? path.resolve(process.env.WASM_MODULES_ROOT)
  : dataPath('wasm-modules');

/**
 * What one exec is allowed to consume. Without these a guest is bounded by nothing, and
 * two of the three failure modes take down the GATEWAY rather than the sandbox:
 *
 *   maxOutputBytes — execCommand buffers stdout/stderr in memory to return them. A guest
 *                    printing in a loop therefore OOMs the server, not itself. This is the
 *                    most dangerous of the three and the only one that is purely ours.
 *   timeoutMs      — `loop { br 0 }` is four bytes of wasm. Without a clock, that child
 *                    lives forever and enough of them exhaust the box.
 *   maxMemoryMb    — address-space cap on the guest process.
 *
 * The first two are enforced by the parent and are fully portable, because the parent is
 * not the thing that blocks. The third needs the OS (see limitedArgv).
 */
export interface WasmLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryMb: number;
}

export const DEFAULT_LIMITS: WasmLimits = {
  timeoutMs: 30_000,
  maxOutputBytes: 8 * 1024 * 1024,
  maxMemoryMb: 512,
};

/** Why a guest was killed, so callers can say so instead of reporting a bare exit code. */
export type KillReason = 'timeout' | 'output';

interface WasmSandbox {
  spec: SandboxSpec;
  /** The directory of .wasm modules this sandbox may run. */
  modulesDir: string;
  /** WASI preopens: guest path → host path. The worktree arrives here. */
  preopens: Record<string, string>;
  state: SandboxState;
  /** Live exec children, so destroy() cannot leak one. */
  children: Set<ChildProcess>;
}

/**
 * Slugify an imageTag into one safe path segment. Tags carry `:` ('env:latest') which is a
 * drive separator on Windows, so it is folded rather than rejected.
 * ponytail: folding can collide two tags onto one directory. Harmless while a tag maps to
 * a hand-placed module dir; revisit when the WASM IBuilder starts generating them.
 */
export function moduleDirName(imageTag: string): string {
  const slug = imageTag.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!SEGMENT.test(slug)) throw new Error(`Cannot derive a module directory from '${imageTag}'.`);
  return slug;
}

export class WasmDriver implements ISandboxDriver {
  private sandboxes = new Map<string, WasmSandbox>();
  private shim?: WasmExecdShim;

  constructor(
    private modulesRoot: string = WASM_MODULES_ROOT,
    private limits: WasmLimits = DEFAULT_LIMITS,
  ) {}

  /**
   * Wrap the guest argv so the OS caps its address space.
   *
   * `ulimit` is a shell builtin, so this needs a shell — but NOTHING is interpolated into
   * the script. The values ride as POSITIONAL PARAMETERS and `"$@"` re-expands them as
   * argv, so a module name still cannot inject shell syntax. (`sh -c SCRIPT name a b`
   * gives $0=name, $1=a, $2=b; one shift drops the limit and leaves the real command.)
   *
   * POSIX only. Windows has no ulimit, so a dev box gets the timeout and output caps but
   * not this one — stated rather than silently skipped, because production is Linux and
   * this is the limit that stops a guest eating the host's RAM.
   */
  private limitedArgv(bin: string, args: string[]): { bin: string; args: string[] } {
    if (process.platform === 'win32' || !this.limits.maxMemoryMb) return { bin, args };
    return {
      bin: 'sh',
      args: [
        '-c',
        'ulimit -v "$1" 2>/dev/null; shift; exec "$@"',
        'sh',
        String(this.limits.maxMemoryMb * 1024), // ulimit -v counts KiB
        bin,
        ...args,
      ],
    };
  }

  /**
   * Run a guest under the wall-clock and output caps, feeding each chunk to `onChunk`.
   * Resolves with the exit code and why it died, if it was killed.
   *
   * The counter spans BOTH streams: a guest that splits its flood across stdout and stderr
   * is still one flood, and the memory it costs the gateway is the sum.
   */
  private runLimited(
    child: ChildProcess,
    onChunk: (stream: 'stdout' | 'stderr', chunk: string) => void,
  ): Promise<{ exitCode: number; killedBy?: KillReason }> {
    return new Promise((resolve) => {
      let bytes = 0;
      let killedBy: KillReason | undefined;

      const stop = (reason: KillReason) => {
        if (killedBy) return; // already dying; don't re-kill or overwrite the reason
        killedBy = reason;
        child.kill();
      };

      const timer = setTimeout(() => stop('timeout'), this.limits.timeoutMs);

      const pipe = (stream: 'stdout' | 'stderr') => {
        child[stream]!.on('data', (chunk: Buffer) => {
          if (killedBy) return; // output after the kill decision is dropped, not counted
          bytes += chunk.length;
          if (bytes > this.limits.maxOutputBytes) {
            stop('output');
            return;
          }
          onChunk(stream, chunk.toString());
        });
      };
      pipe('stdout');
      pipe('stderr');

      const finish = (exitCode: number) => {
        clearTimeout(timer); // an un-cleared timer holds the event loop open
        resolve({ exitCode, killedBy });
      };
      child.on('error', () => finish(-1));
      child.on('close', (code) => finish(code ?? -1));
    });
  }

  /** No PTY: WASI preview1 has no fork/exec, so there is no shell to attach a TTY to.
   *  The terminal transport factory reads this and falls back to line-mode exec. */
  public capabilities(): DriverCapabilities {
    return { exec: true, pty: false };
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  public async bootSandbox(spec: SandboxSpec): Promise<SandboxStatus> {
    const sandboxId = `wsm-${crypto.randomUUID()}`;
    const modulesDir = path.join(this.modulesRoot, moduleDirName(spec.imageTag));

    // Fail at boot, not at the first exec: a missing module set is a broken environment,
    // and finding out when the user types a command is a worse place to learn it.
    await fsp.access(modulesDir).catch(() => {
      throw new Error(`No WASM modules for image '${spec.imageTag}' (looked in ${modulesDir}).`);
    });

    this.sandboxes.set(sandboxId, {
      spec,
      modulesDir,
      preopens: preopensFor(spec),
      state: 'RUNNING',
      children: new Set(),
    });

    // No execdPort: nothing is listening. resolveExecConnection says so explicitly.
    return { sandboxId, state: 'RUNNING' };
  }

  public async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const sandbox = this.sandboxes.get(sandboxId);
    return sandbox
      ? { sandboxId, state: sandbox.state }
      : { sandboxId, state: 'STOPPED', message: 'Unknown sandbox.' };
  }

  /**
   * Pause/resume are bookkeeping. A wasm sandbox holds no process while idle, so there is
   * nothing to suspend — which is the point: scale-to-zero costs nothing to reverse.
   */
  public async pauseSandbox(sandboxId: string): Promise<boolean> {
    return this.setState(sandboxId, 'PAUSED');
  }

  public async resumeSandbox(sandboxId: string): Promise<boolean> {
    return this.setState(sandboxId, 'RUNNING');
  }

  public async destroySandbox(sandboxId: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return false;
    for (const child of sandbox.children) child.kill();
    this.sandboxes.delete(sandboxId);
    return true;
  }

  private setState(sandboxId: string, state: SandboxState): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return false;
    sandbox.state = state;
    return true;
  }

  // ─── exec ─────────────────────────────────────────────────────────────────

  public async execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult> {
    const { child } = this.spawnGuest(sandboxId, payload.command, payload.env);
    let stdout = '';
    let stderr = '';

    const { exitCode, killedBy } = await this.runLimited(child, (stream, chunk) => {
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    });

    // Say why it stopped. A bare non-zero exit after a kill looks like the program's own
    // failure, which sends people debugging the wrong thing.
    if (killedBy) stderr += `\n[sandbox] killed: ${limitMessage(killedBy, this.limits)}\n`;
    return { stdout, stderr, exitCode };
  }

  /** Raw stdio to a guest — what LspProxy's `exec:` transport speaks over. */
  public async openExecStream(sandboxId: string, command: string[]): Promise<Duplex> {
    const { bin, args } = this.guestArgv(sandboxId, command);
    return spawnDuplex(bin, args);
  }

  /**
   * Run a guest, delivering output a LINE at a time. The shape the execd shim serves, and
   * the shape the terminal wants: one JSON event per line.
   */
  public async execLines(
    sandboxId: string,
    command: string[],
    env: Record<string, string> | undefined,
    onLine: (type: 'stdout' | 'stderr', text: string) => void,
  ): Promise<number> {
    const { child } = this.spawnGuest(sandboxId, command, env);

    // Partial reads must not become partial lines: a chunk boundary can land mid-line, and
    // the terminal renders one event as one line. `pending` is per-stream and bounded by
    // the same output cap, since runLimited counts bytes before they get here.
    const pending: Record<string, string> = { stdout: '', stderr: '' };
    const { exitCode, killedBy } = await this.runLimited(child, (stream, chunk) => {
      const lines = (pending[stream] + chunk).split('\n');
      pending[stream] = lines.pop() ?? '';
      for (const line of lines) onLine(stream, line.replace(/\r$/, ''));
    });

    // Flush whatever never got its newline, then explain a kill on the same channel.
    for (const stream of ['stdout', 'stderr'] as const) {
      if (pending[stream]) onLine(stream, pending[stream]);
    }
    if (killedBy) onLine('stderr', `[sandbox] killed: ${limitMessage(killedBy, this.limits)}`);
    return exitCode;
  }

  /**
   * The loopback execd stand-in (wasmExecdShim.ts). Started on first use rather than at
   * boot so a deployment that never opens a terminal never opens a port.
   */
  public async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    if (!this.sandboxes.has(sandboxId)) throw new Error(`Unknown sandbox ${sandboxId}.`);
    if (!this.shim) this.shim = new WasmExecdShim(this);
    await this.shim.start();
    return { baseUrl: this.shim.baseUrl(sandboxId), accessToken: this.shim.token };
  }

  /** Release the loopback port. Tests and a graceful shutdown both need this. */
  public async close(): Promise<void> {
    await this.shim?.stop();
    this.shim = undefined;
  }

  /**
   * Nothing can listen: WASI preview1 has no sockets. This is the single capability that
   * moving to wasmtime (wasi-sockets) buys, at which point the host owns the real socket
   * and this returns a plain 127.0.0.1 URL that preview ingress proxies to unchanged.
   */
  public async resolveEndpoint(_sandboxId: string, port: number): Promise<SandboxEndpoint> {
    throw new Error(`Nothing is listening on port ${port}: WASI preview1 has no sockets.`);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Resolve `command` to the node argv that runs it, or throw a user-legible reason. */
  private guestArgv(sandboxId: string, command: string[]): { bin: string; args: string[]; sandbox: WasmSandbox } {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Unknown sandbox ${sandboxId}.`);

    const program = command[0];
    if (!program) throw new Error('No command given.');
    if (!SEGMENT.test(program)) throw new Error(`'${program}' is not a valid program name.`);

    const modulePath = path.join(sandbox.modulesDir, `${program}.wasm`);
    return {
      sandbox,
      bin: process.execPath,
      args: [
        // --no-warnings: node:wasi is flagged experimental, and that warning would otherwise
        // be prepended to every guest's stderr.
        '--no-warnings',
        '-e', RUNNER,
        modulePath,
        JSON.stringify(sandbox.preopens),
        JSON.stringify({ ...sandbox.spec.envVars }),
        ...command,
      ],
    };
  }

  private spawnGuest(sandboxId: string, command: string[], env?: Record<string, string>) {
    const { bin, args, sandbox } = this.guestArgv(sandboxId, command);
    if (env && Object.keys(env).length) {
      // Per-exec env overrides the sandbox's, matching how execCommand behaves elsewhere.
      args[5] = JSON.stringify({ ...sandbox.spec.envVars, ...env });
    }
    const limited = this.limitedArgv(bin, args);
    const child = spawn(limited.bin, limited.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    sandbox.children.add(child);
    child.on('close', () => sandbox.children.delete(child));
    return { child, sandbox };
  }
}

/**
 * The spec's volumes become WASI preopens. A preopen is the whole of a guest's filesystem
 * authority — it can reach nothing it was not handed, which is why this tier needs no
 * egress/nftables machinery to be isolated.
 *
 * WASI preview1 has no chdir, so SandboxExecRequest.cwd is NOT honoured; a guest resolves
 * relative paths against its preopens. Programs are given absolute paths instead.
 */
export /** A kill reason the user can act on — which limit, and what it was set to. */
function limitMessage(reason: KillReason, limits: WasmLimits): string {
  return reason === 'timeout'
    ? `exceeded the ${limits.timeoutMs} ms time limit`
    : `produced more than ${limits.maxOutputBytes} bytes of output`;
}

export function preopensFor(spec: SandboxSpec): Record<string, string> {
  const preopens: Record<string, string> = {};
  for (const volume of spec.volumes ?? []) {
    if (volume.hostPath) preopens[volume.mountPath] = volume.hostPath;
  }
  return preopens;
}
