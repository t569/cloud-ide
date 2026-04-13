import path from 'node:path';
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo, RustEngineAPI } from '../../types/engine';

export interface IRustEngineClient {
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  resumeSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo>;
  getSandboxIp(sandboxId: string): string | null;
}

let cachedEngine: RustEngineAPI | null = null;

function loadEngine(): RustEngineAPI {
  if (cachedEngine) {
    return cachedEngine;
  }

  const candidates = [
    path.resolve(process.cwd(), 'src-rust', 'src', 'api', 'index.node'),
    path.resolve(process.cwd(), 'src', 'api', 'index.node'),
    path.resolve(__dirname, '../../../src-rust/src/api/index.node'),
    path.resolve(__dirname, '../../../../src-rust/src/api/index.node'),
  ];

  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cachedEngine = require(candidate) as RustEngineAPI;
      return cachedEngine;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to load Rust sandbox engine. Last error: ${String(lastError)}`);
}

export class RustEngineClient implements IRustEngineClient {
  private get engine(): RustEngineAPI {
    return loadEngine();
  }

  public bootSandbox(spec: SandboxSpec): Promise<SandboxStatus> {
    return this.engine.bootSandbox(spec);
  }

  public getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    return this.engine.getSandboxStatus(sandboxId);
  }

  public execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult> {
    return this.engine.execCommand(sandboxId, payload);
  }

  public pauseSandbox(sandboxId: string): Promise<boolean> {
    return this.engine.pauseSandbox(sandboxId);
  }

  public resumeSandbox(sandboxId: string): Promise<boolean> {
    return this.engine.resumeSandbox(sandboxId);
  }

  public destroySandbox(sandboxId: string): Promise<boolean> {
    return this.engine.destroySandbox(sandboxId);
  }

  public resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    return this.engine.resolveExecConnection(sandboxId);
  }

  public getSandboxIp(sandboxId: string): string | null {
    return this.engine.getSandboxIp(sandboxId);
  }
}
