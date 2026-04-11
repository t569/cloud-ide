// backend/src/services/sandbox/SandboxManager.ts

// this imports our engine functions from our rust backend precompiled binary

// TODO: modify the docs
/**
 * DEPRECIATED DOCS
 * For Local Development (Fast Compile, Unoptmized):
 * npx napi build --platform --cargo-cwd src-rust
 * 
 * For Production (Slow Compile, Highly Optimized):
 * npm napi build --platform --release --cargo-cwd src-rust
 * 
 * 
 * What actually happens when you run that command?
  NAPI reads your package.json and tells Cargo to start building.

  Cargo runs build.rs, which downloads the C headers for Node.js.

  Cargo compiles your lib.rs and the OpenSandbox HTTP engine.

  Finally, NAPI takes the resulting .so, .dylib, or .dll file from the Rust target folder, renames it to index.node, 
  and moves it to the root of your backend directory.
 */
import { RustEngineAPI } from '../../types/engine';
import { SandboxSpec, SandboxRecord, SandboxStatus } from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../../database/interfaces/ISandboxRepository';

// Safely cast the C-binary to our strict TS interface
const rustEngine = require('../../../index.node') as RustEngineAPI;


/**
 * @class SandboxManager
 * @description The TypeScript Bridge to the native Rust Infrastructure Engine. 
 * This class abstracts away the FFI (Foreign Function Interface) boundary. 
 * The Node.js application calls these standard async methods, which internally 
 * execute the high-performance, GC-free Rust binary to manage OpenSandbox containers.
 */
export class SandboxManager {
  constructor(private sandboxRepo: ISandboxRepository) {}

  /**
   * @method provision
   * @description Requests compute infrastructure from the Rust Engine. Rust handles 
   * the networking, OpenSandbox communication, and thread-safe IP mapping.
   * * @param {SandboxSpec} spec - The blueprint for the requested environment.
   * @returns {Promise<SandboxRecord>} The persisted database record of the new infrastructure.
   */
  public async provision(spec: SandboxSpec): Promise<SandboxRecord> {
    console.log(`[SandboxManager] Delegating boot sequence to Rust Core...`);

    try {
      // 1. Cross the FFI boundary. 
      // Rust returns a structured object: { sandboxId, ipAddress, state }
      const rustStatus: SandboxStatus = await rustEngine.bootSandbox(spec);

      // 2. Map the response to the exact SandboxRecord schema
      const record: SandboxRecord = {
        sandboxId: rustStatus.sandboxId,
        environmentId: spec.imageTag,
        state: rustStatus.state, 
        ipAddress: rustStatus.ipAddress, 
        execdPort: rustStatus.execdPort, 
        volumeMounts: spec.volumes ? spec.volumes.map(v => v.mountPath) : [], 
        createdAt: Date.now(),
      };


      // 3. Persist to the database so we survive backend server restarts
      await this.sandboxRepo.save(record);
      return record;

    } catch (error: any) {
      console.error(`\x1b[31m[Rust Engine Fault]\x1b[0m`, error.message);
      throw new Error("Failed to provision infrastructure.");
    }
  }

  /**
   * @method pause
   * @description Tells the Rust engine to freeze the underlying Linux cgroups of the container, 
   * paging RAM to disk to save compute costs while preserving state.
   * * @param {string} sandboxId - The unique ID of the infrastructure to pause.
   * @returns {Promise<boolean>} True if successfully paused.
   */
  public async pause(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to pause ${sandboxId}...`);
    
    try {
      const success = await rustEngine.pauseSandbox(sandboxId);
      if (success) {
         await this.sandboxRepo.updateState(sandboxId, 'PAUSED');
      }
      return success;
    } catch (error: any) {
      console.error(`\x1b[31m[Rust Engine Fault]\x1b[0m Failed to pause:`, error.message);
      throw new Error(`Failed to pause sandbox ${sandboxId}`);
    }
  }

  /**
   * @method destroy
   * @description Tells the Rust engine to permanently terminate the container and flush 
   * it from the internal Rust DashMap (memory map).
   * * @param {string} sandboxId - The unique ID of the infrastructure to destroy.
   * @returns {Promise<boolean>} True if successfully destroyed.
   */
  public async destroy(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to destroy ${sandboxId}...`);

    try {
      const success = await rustEngine.destroySandbox(sandboxId);
      if (success) {
         await this.sandboxRepo.delete(sandboxId);
      }
      return success;
    } catch (error: any) {
      console.error(`\x1b[31m[Rust Engine Fault]\x1b[0m Failed to destroy:`, error.message);
      throw new Error(`Failed to destroy sandbox ${sandboxId}`);
    }
  }
}