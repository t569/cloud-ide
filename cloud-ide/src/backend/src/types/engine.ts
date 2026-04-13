// backend/src/types/engine.ts

import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';

export interface ExecConnectionInfo {
  baseUrl: string;
  accessToken?: string | null;
}

// THE BRIDGE INTERFACE
export interface RustEngineAPI {
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  resumeSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo>;
  getSandboxIp(sandboxId: string): string | null;
}