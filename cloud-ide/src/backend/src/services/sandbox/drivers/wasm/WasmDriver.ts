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

  constructor(private modulesRoot: string = WASM_MODULES_ROOT) {}

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
    child.stdout!.on('data', (c) => { stdout += c; });
    child.stderr!.on('data', (c) => { stderr += c; });
    const exitCode = await new Promise<number>((resolve) => {
      child.on('error', () => resolve(-1));
      child.on('close', (code) => resolve(code ?? -1));
    });
    return { stdout, stderr, exitCode };
  }

  /** Raw stdio to a guest — what LspProxy's `exec:` transport speaks over. */
  public async openExecStream(sandboxId: string, command: string[]): Promise<Duplex> {
    const { bin, args } = this.guestArgv(sandboxId, command);
    return spawnDuplex(bin, args);
  }

  /**
   * Phase 1 has no execd to point at: the guest runs in a child process on this host, not
   * behind an HTTP server. SandboxController streams exec by fetching this URL directly, so
   * making one up would fail confusingly at the fetch instead of clearly here.
   * Phase 1b adds a loopback shim speaking execd's protocol (bare newline JSON, NOT SSE).
   */
  public async resolveExecConnection(_sandboxId: string): Promise<ExecConnectionInfo> {
    throw new Error('The wasm driver has no execd endpoint yet (see docs/plans/wasm-runtime.md).');
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
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
export function preopensFor(spec: SandboxSpec): Record<string, string> {
  const preopens: Record<string, string> = {};
  for (const volume of spec.volumes ?? []) {
    if (volume.hostPath) preopens[volume.mountPath] = volume.hostPath;
  }
  return preopens;
}
