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
import { Duplex } from 'node:stream';
import { ExecConnectionInfo, SandboxEndpoint } from '../../../types/engine';

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

  /** How to reach a USER'S service on `port` inside the sandbox (a dev server on 5173,
   *  an API on 8000) — the target the preview ingress proxies to. The only supported way
   *  in: providers do not expose container IPs. Returns the URL *and* the headers the
   *  provider requires with it (see SandboxEndpoint — a bare URL is not enough, and
   *  dropping the headers 401s on any keyed deployment). Rejects when nothing is
   *  listening on `port`. Reaching execd is `resolveExecConnection`, not this. */
  resolveEndpoint(sandboxId: string, port: number): Promise<SandboxEndpoint>;

  // --- capability probe ---
  capabilities(): DriverCapabilities;

  // --- OPTIONAL interactive PTY (Phase 2). Absent ⇒ the driver is exec-only. ---
  openSession?(sandboxId: string, opts: PtyOptions): Promise<ISandboxSession>;

  /**
   * OPTIONAL raw bidirectional stdio to a long-lived process inside the sandbox.
   * Absent ⇒ the driver cannot host in-container language servers, and `exec:`
   * entries in LSP_SERVERS are unavailable (the language reports offline).
   *
   * Distinct from execCommand, which is one-shot and buffered — this is a stream
   * that stays open, which is what a JSON-RPC session needs. Distinct from
   * openSession, which allocates a TTY: a TTY would corrupt the protocol framing.
   *
   * The Duplex must die with the process and vice-versa (see spawnDuplex).
   */
  openExecStream?(sandboxId: string, command: string[]): Promise<Duplex>;
}
