import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo, RustEngineAPI, SandboxEndpoint } from '../../types/engine';
import { ISandboxDriver, DriverCapabilities } from './drivers/ISandboxDriver';
import { OpenSandboxEngine } from './openSandboxEngine';

let cachedEngine: RustEngineAPI | null = null;

/**
 * @function loadEngine
 * @description Returns the OpenSandbox engine — now a pure-TS implementation
 * (`openSandboxEngine.ts`), an HTTP client to the OpenSandbox daemon. The old Rust
 * napi binary (`index.node`, src-rust) was doing no CPU work and is deprecated; this
 * removes the FFI boundary and the toolchain requirement. Cached as a singleton so
 * the in-memory sandbox->IP routing table persists across calls.
 */
function loadEngine(): RustEngineAPI {
  return (cachedEngine ??= new OpenSandboxEngine());
}

/**
 * @class RustEngineClient
 * @description The OpenSandbox driver. It is the concrete `ISandboxDriver` for the
 * default provider. Name kept for continuity (createSandboxDriver, docs) even though
 * the engine underneath is now TypeScript, not Rust. A future AlibabaSdkDriver would
 * implement the same interface (see backend/TERMINAL_BACKEND.md).
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

  public resolveEndpoint(sandboxId: string, port: number): Promise<SandboxEndpoint> {
    return this.engine.resolveEndpoint(sandboxId, port);
  }
}
