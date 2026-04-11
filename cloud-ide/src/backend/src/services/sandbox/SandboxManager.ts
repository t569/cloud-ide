// backend/src/services/sandbox/SandboxManager.ts

import { 
  bootSandbox, 
  pauseSandbox, 
  destroySandbox, 
  getSandboxStatus,
  getSandboxIp
} from '../../../index.node'; 

import { SandboxSpec, SandboxRecord } from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../../database/interfaces/ISandboxRepository';

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
      const rustStatus = await bootSandbox(spec.imageTag);

      // 2. Construct the database record
      const record: SandboxRecord = {
        sandboxId: rustStatus.sandboxId,
        environmentId: spec.imageTag,
        state: 'RUNNING', 
        ipAddress: rustStatus.ipAddress, // Crucial for direct TCP/WebSocket routing
        volumeMounts: [], 
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
      const success = await pauseSandbox(sandboxId);
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
      const success = await destroySandbox(sandboxId);
      if (success) {
         await this.sandboxRepo.delete(sandboxId);
      }
      return success;
    } catch (error: any) {
      console.error(`\x1b[31m[Rust Engine Fault]\x1b[0m Failed to destroy:`, error.message);
      throw new Error(`Failed to destroy sandbox ${sandboxId}`);
    }
  }

  /**
   * @method getInternalIp
   * @description A synchronous, zero-latency lookup used by the Edge Proxy to route 
   * incoming terminal WebSockets directly to the active OpenSandbox container.
   * * @param {string} sandboxId - The unique ID of the active sandbox.
   * @returns {string | null} The internal IP address, or null if the sandbox is off/missing.
   */
  public getInternalIp(sandboxId: string): string | null {
    // This instantly reads from the Rust DashMap without async overhead.
    return getSandboxIp(sandboxId); 
  }
}