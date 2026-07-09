// backend/src/services/sandbox/drivers/AlibabaSdkDriver.ts
//
// ⚠️ UNVERIFIED SCAFFOLD (TERMINAL_BACKEND.md step 5). This is the FIRST driver
// that can deliver a real interactive PTY, because execd can't (see 3a). It is
// NOT the default and has NOT been run against a live OpenSandbox service.
//
// What IS solid: the SdkSession adapter below faithfully mirrors the SDK calls
// the frontend `SessionStream.ts` already uses in production (commands.run bash
// background + sendStdin + resize + kill), and it is unit-tested.
//
// What needs VALIDATION before this is "real" (all marked TODO(validate)):
//   1. `npm i @alibaba-group/opensandbox` in the backend (dynamic-imported here
//      so the build stays green without it).
//   2. The SDK runs under Node and the ConnectionConfig/auth below is how you
//      connect server-side (endpoint + API key/token).
//   3. Whether the SDK exposes a process-exit event (onExit wiring).
//
// Design: composition. Lifecycle/exec delegate to a wrapped driver (the Rust
// kernel); only openSession is the SDK's job. So OpenSandbox lifecycle stays on
// the proven path and we add just the interactive shell.
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo } from '../../../types/engine';
import { config } from '../../../config/env';
import { ISandboxDriver, ISandboxSession, PtyOptions, DriverCapabilities } from './ISandboxDriver';

/** Minimal shape of the SDK's background process we depend on (from SessionStream). */
export interface SdkPtyProcess {
  sendStdin?(data: string): void;
  stdin?: { write(data: string): void };
  resize?(cols: number, rows: number): void;
  kill(): void;
  onExit?(cb: (code: number) => void): void; // TODO(validate): confirm SDK exposes this
}

/**
 * Adapts the SDK's background `bash` into our ISandboxSession. This is the
 * reviewable, high-confidence half (mirrors SessionStream). The driver wires the
 * SDK's stdout/stderr handlers to pushOutput(). Output that arrives before a
 * consumer attaches onData is buffered, so no early bytes are lost.
 */
export class SdkSession implements ISandboxSession {
  private pty?: SdkPtyProcess;
  private dataCb?: (chunk: Buffer) => void;
  private exitCb: (code: number) => void = () => {};
  private buffer: Buffer[] = [];

  /** Wire the SDK process in once run() has returned it. */
  attach(pty: SdkPtyProcess): void {
    this.pty = pty;
    pty.onExit?.((code) => this.exitCb(code));
  }

  /** Fed by the SDK's onStdout/onStderr handlers. */
  pushOutput(text: string): void {
    const chunk = Buffer.from(text);
    if (this.dataCb) this.dataCb(chunk);
    else this.buffer.push(chunk);
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb;
    for (const chunk of this.buffer) cb(chunk);
    this.buffer = [];
  }
  onExit(cb: (code: number) => void): void {
    this.exitCb = cb;
  }
  write(data: string): void {
    if (this.pty?.sendStdin) this.pty.sendStdin(data);
    else this.pty?.stdin?.write(data);
  }
  resize(cols: number, rows: number): void {
    this.pty?.resize?.(cols, rows);
  }
  close(): void {
    this.pty?.kill();
  }
}

export class AlibabaSdkDriver implements ISandboxDriver {
  // The wrapped driver handles everything the SDK doesn't (boot/pause/exec/…).
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
    return { exec: this.lifecycle.capabilities().exec, pty: true };
  }

  async openSession(sandboxId: string, opts: PtyOptions): Promise<ISandboxSession> {
    let sdk: any;
    try {
      // Dynamic import: optional dependency, not bundled by default so the build
      // stays green without it. @ts-ignore because it isn't installed here yet.
      // @ts-ignore
      sdk = await import('@alibaba-group/opensandbox');
    } catch {
      throw new Error(
        'AlibabaSdkDriver requires @alibaba-group/opensandbox — run `npm i @alibaba-group/opensandbox` in the backend.',
      );
    }
    const { Sandbox, ConnectionConfig } = sdk;

    // TODO(validate): confirm this endpoint/auth is correct for a server-side
    // connect (frontend SessionStream connects to a per-sandbox endpoint; here
    // we start from the lifecycle API URL). The API key almost certainly needs
    // to attach somewhere on the connection config.
    const url = new URL(config.OPENSANDBOX_API_URL);
    const connectionConfig = new ConnectionConfig({
      domain: url.host,
      protocol: url.protocol.replace(':', ''),
    });
    const sandbox = await Sandbox.connect({ sandboxId, connectionConfig });

    const session = new SdkSession();
    const pty: SdkPtyProcess = await sandbox.commands.run(
      opts.shell ?? 'bash',
      { background: true, env: { TERM: 'xterm-256color', ...(opts.env ?? {}) } },
      {
        onStdout: (m: any) => session.pushOutput(m.text ?? m.data ?? ''),
        onStderr: (m: any) => session.pushOutput(m.text ?? m.data ?? ''),
      },
    );
    session.attach(pty);
    pty.resize?.(opts.cols, opts.rows);
    return session;
  }
}
