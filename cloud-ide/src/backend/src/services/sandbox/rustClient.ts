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

/**
 * @function loadEngine
 * @description Dynamically loads the compiled Rust N-API binary (`index.node`).
 * * Node.js execution contexts vary heavily depending on whether the app is 
 * running via `ts-node`, `nodemon`, or as a compiled production build. 
 * This loader implements a multi-path fallback strategy to locate the binary 
 * regardless of the current working directory.
 * * @returns {RustEngineAPI} The strongly-typed FFI interface to the Rust kernel.
 * @throws {Error} If the `.node` binary cannot be found or is compiled for the wrong OS architecture.
 */
function loadEngine(): RustEngineAPI {
  if (cachedEngine) {
    return cachedEngine;
  }

  const candidates = [
    // 1. The correct path (backend root)
    path.resolve(__dirname, '../../../index.node'),
    
    // Fallbacks
    path.resolve(process.cwd(), 'index.node'),
    path.resolve(process.cwd(), 'src-rust', 'src', 'api', 'index.node'),
    path.resolve(__dirname, '../../../../src-rust/src/api/index.node'),
  ];

  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      console.log(`[RustEngine] Attempting to load: ${candidate}`);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cachedEngine = require(candidate) as RustEngineAPI;
      console.log(`[RustEngine] ✅ Successfully loaded from: ${candidate}`);
      return cachedEngine;
    } catch (error: any) {
      console.log(`[RustEngine] ❌ Failed at ${candidate} -> ${error.code || error.message}`);
      errors.push(`\n- ${candidate}\n  Reason: ${error.message}`);
    }
  }

  throw new Error(`Unable to load Rust sandbox engine. Diagnostics:${errors.join('')}`);
}

/**
 * @class RustEngineClient
 * @description The TypeScript proxy for the Rust Sandbox Engine. 
 * This class abstracts the N-API boundary, allowing the rest of the Node.js 
 * application to interact with the underlying hypervisor/container runtime 
 * (via Rust) using standard Promises and strict TypeScript interfaces.
 */
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
