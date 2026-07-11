// backend/src/services/sandbox/drivers/DockerPtyDriver.ts
//
// Interactive PTY via `docker exec -it sandbox-<id>` wrapped in a host PTY
// (node-pty). This is the approach chosen over the Alibaba SDK path: the gateway
// is colocated with dockerd (WSL), the SAME assumption Slice 5's `docker logs`
// and the bind-mounted /workspace already make. execd can't give a real TTY, so
// this is the first driver that lights up vim/top/colors/line-editing.
//
// Composition, exactly like AlibabaSdkDriver: lifecycle + exec delegate to the
// wrapped driver (the OpenSandbox/Rust kernel); only openSession is ours. So the
// proven boot/exec path is untouched and we add just the interactive shell.
//
// node-pty is loaded at runtime via require(), not a static import, so Windows
// tsc stays green without the native module built there (it builds in WSL, where
// the stack runs). capabilities().pty reflects whether it actually loaded, so a
// missing node-pty degrades honestly to line-mode SSE instead of a broken PTY.
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo } from '../../../types/engine';
import { ISandboxDriver, ISandboxSession, PtyOptions, DriverCapabilities } from './ISandboxDriver';

// node-pty's IPty surface we touch. `any` module (no static types) so tsc needs
// nothing installed; this keeps the calls we make honest at least locally.
interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

let ptyModule: any; // undefined = not probed yet, null = unavailable
function loadPty(): any {
  if (ptyModule === undefined) {
    try {
      ptyModule = require('node-pty');
    } catch {
      ptyModule = null;
    }
  }
  return ptyModule;
}

/** Adapts a node-pty process to our transport-neutral ISandboxSession. */
export class DockerPtySession implements ISandboxSession {
  constructor(private pty: IPty) {}
  onData(cb: (chunk: Buffer) => void): void {
    this.pty.onData((d) => cb(Buffer.from(d, 'utf8')));
  }
  onExit(cb: (code: number) => void): void {
    this.pty.onExit((e) => cb(e.exitCode));
  }
  write(data: string): void {
    this.pty.write(data);
  }
  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }
  close(): void {
    this.pty.kill();
  }
}

export class DockerPtyDriver implements ISandboxDriver {
  // The wrapped driver handles everything docker exec doesn't (boot/pause/exec/…).
  constructor(private lifecycle: ISandboxDriver) {}

  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus> { return this.lifecycle.bootSandbox(spec); }
  getSandboxStatus(id: string): Promise<SandboxStatus> { return this.lifecycle.getSandboxStatus(id); }
  pauseSandbox(id: string): Promise<boolean> { return this.lifecycle.pauseSandbox(id); }
  resumeSandbox(id: string): Promise<boolean> { return this.lifecycle.resumeSandbox(id); }
  destroySandbox(id: string): Promise<boolean> { return this.lifecycle.destroySandbox(id); }
  execCommand(id: string, p: SandboxExecRequest): Promise<SandboxExecResult> { return this.lifecycle.execCommand(id, p); }
  resolveExecConnection(id: string): Promise<ExecConnectionInfo> { return this.lifecycle.resolveExecConnection(id); }
  resolveEndpoint(id: string, port: number): Promise<string> { return this.lifecycle.resolveEndpoint(id, port); }

  capabilities(): DriverCapabilities {
    // pty only if node-pty actually loaded — otherwise the transport factory must
    // fall back to SSE rather than open a PTY socket that immediately dies.
    return { exec: this.lifecycle.capabilities().exec, pty: !!loadPty() };
  }

  async openSession(sandboxId: string, opts: PtyOptions): Promise<ISandboxSession> {
    const pty = loadPty();
    if (!pty) {
      throw new Error('DockerPtyDriver requires node-pty — run `npm i node-pty` in the backend.');
    }

    // ponytail: default shell `bash`. Env images are ubuntu-based and ship it; if an
    // image lacks it the exec exits non-zero and the tab closes. Add an sh fallback
    // when a shell-less base image actually appears.
    const shell = opts.shell ?? 'bash';
    // Array args (never a shell string) so a sandboxId can't inject flags. `-it` =
    // interactive + TTY; node-pty gives docker a real host PTY so `-t` succeeds.
    const args = [
      'exec', '-it',
      '-e', `TERM=${opts.env?.TERM ?? 'xterm-256color'}`,
      '-w', opts.cwd ?? '/workspace',
      `sandbox-${sandboxId}`,
      shell,
    ];

    const child: IPty = pty.spawn('docker', args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.cwd(),
      env: process.env,
    });

    return new DockerPtySession(child);
  }
}
