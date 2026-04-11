// backend/src/database/interfaces/ISsandboxRepository.ts

import { SandboxRecord, SandboxState } from '@cloud-ide/shared/types/sandbox';

export interface ISandboxRepository {
  // Core CRUD
  save(sandbox: SandboxRecord): Promise<void>;
  get(sandboxId: string): Promise<SandboxRecord | null>;
  delete(sandboxId: string): Promise<void>;

  // State Management
  updateState(sandboxId: string, state: SandboxState): Promise<void>;

  // Relational Lookup: Find all sandboxes running a specific image/environment
  // Useful for finding "warm" sandboxes to assign to new users
  getSandboxesByEnvId(envId: string): Promise<SandboxRecord[]>;
}