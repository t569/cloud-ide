import path from 'node:path';
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo, RustEngineAPI } from '../../types/engine';
import { ISandboxDriver, DriverCapabilities } from './drivers/ISandboxDriver';

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
 * @description The OpenSandbox driver, implemented via our Rust kernel. It is the
 * concrete `ISandboxDriver` for the default provider: the TS proxy over the N-API
 * boundary to the container runtime. A future AlibabaSdkDriver would implement the
 * same interface (see backend/TERMINAL_BACKEND.md).
 *
 * ponytail: kept named RustEngineClient (not OpenSandboxDriver) and in this file
 * on purpose — loadEngine() resolves index.node relative to __dirname, so moving
 * or renaming the file would silently break the FFI loader at runtime.
 */
export class RustEngineClient implements ISandboxDriver {
  private get engine(): RustEngineAPI {
    return loadEngine();
  }

  /** Rust-kernel path is line-mode exec only for now; PTY arrives with openSession. */
  public capabilities(): DriverCapabilities {
    return { exec: true, pty: false };
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
