// backend/src/types/engine.ts

import { SandboxSpec, SandboxStatus } from '@cloud-ide/shared/types/sandbox';

export interface ExecPayload {
  command: string;
  cwd: string;
}

// THE BRIDGE INTERFACE
export interface RustEngineAPI {
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  execCommand(sandboxId: string, payload: ExecPayload): Promise<string>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  getSandboxIp(sandboxId: string): string | null;
}