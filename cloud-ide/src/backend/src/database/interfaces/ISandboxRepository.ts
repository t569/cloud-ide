// backend/src/database/interfaces/ISsandboxRepository.ts

import { SandboxRecord, SandboxState } from '@cloud-ide/shared/types/sandbox';

/**
 * @interface ISandboxRepository
 * @description The Infrastructure Truth. Tracks the physical compute units 
 * actively managed by the Rust orchestrator.
 */
export interface ISandboxRepository {
  // Core CRUD
  save(sandbox: SandboxRecord): Promise<void>;
  get(sandboxId: string): Promise<SandboxRecord | null>;
  delete(sandboxId: string): Promise<void>;

  /**
   * @description Keeps the database perfectly synchronized with the Rust 
   * engine's state transitions (RUNNING, PAUSED, ERROR).
   */
  updateState(sandboxId: string, state: SandboxState): Promise<void>;

  /**
   * @description The core relational query that allows the SessionController 
   * to find existing "warm" compute nodes and prevent duplicate provisioning.
   */
  getSandboxesByEnvId(envId: string): Promise<SandboxRecord[]>;

  list(): Promise<SandboxRecord[]>;
}