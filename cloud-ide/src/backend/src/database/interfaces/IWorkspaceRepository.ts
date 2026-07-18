// backend/src/database/interfaces/IWorkspaceRepository.ts

import { WorkspaceRecord } from '../models';

/**
 * Persistence for WORKSPACES — the durable, compute-independent half of a sandbox
 * (docs/plans/workspace-entity.md). Same shape as ISandboxRepository; the difference is
 * lifecycle: a sandbox record dies with its container, a workspace record does not.
 */
export interface IWorkspaceRepository {
  save(workspace: WorkspaceRecord): Promise<void>;
  get(workspaceId: string): Promise<WorkspaceRecord | null>;
  delete(workspaceId: string): Promise<void>;
  list(): Promise<WorkspaceRecord[]>;
  /** Every workspace this user owns — the input to the /workspaces manager. */
  listForOwner(ownerId: string): Promise<WorkspaceRecord[]>;
}
