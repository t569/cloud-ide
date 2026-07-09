// backend/src/services/sandbox/drivers/ISandboxDriver.ts
//
// The provider-neutral sandbox driver seam (Phase 1 — see backend/TERMINAL_BACKEND.md).
// One implementation per provider: OpenSandbox via our Rust kernel today
// (RustEngineClient), an Alibaba-SDK driver later. SandboxManager depends only on
// this interface, so swapping providers is a new driver, not a rewrite — and
// vendor/FFI types never leak past a driver implementation.
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo } from '../../../types/engine';

/** What a driver can do. The transport factory reads this to pick a terminal
 *  transport: PTY (interactive) when `pty`, else line-mode exec streaming. */
export interface DriverCapabilities {
  exec: boolean; // one-shot command streaming (execd /command)
  pty: boolean;  // interactive persistent PTY session (openSession)
}

export interface PtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: string; // defaults to the image's login shell
}

/**
 * A live interactive shell session. Bytes are raw PTY I/O; the gateway WS /pty
 * bridge maps these onto the wire (binary frame = stdin/stdout, text = control).
 */
export interface ISandboxSession {
  onData(cb: (chunk: Buffer) => void): void;
  onExit(cb: (code: number) => void): void;
  write(data: string): void;            // stdin
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface ISandboxDriver {
  // --- lifecycle ---
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  resumeSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;

  // --- exec (line-mode; wired today) ---
  execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult>;
  resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo>;

  /** Base URL for a port inside the sandbox (e.g. a dev server on 3000, or execd on
   *  44772). The only supported way to reach a sandbox — providers do not expose
   *  container IPs. Rejects when nothing is listening on `port`. */
  resolveEndpoint(sandboxId: string, port: number): Promise<string>;

  // --- capability probe ---
  capabilities(): DriverCapabilities;

  // --- OPTIONAL interactive PTY (Phase 2). Absent ⇒ the driver is exec-only. ---
  openSession?(sandboxId: string, opts: PtyOptions): Promise<ISandboxSession>;
}
