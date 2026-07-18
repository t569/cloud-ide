// backend/src/services/workspace/WorkspaceManager.ts
//
// The domain service for WORKSPACES — the durable, compute-independent entity
// (docs/plans/workspace-entity.md). Where SandboxManager owns disposable compute,
// this owns what survives it: the lifecycle of a named, reusable workspace.
//
// Phase 1b scope: the ENTITY lifecycle (create / list / get / delete), generating ids,
// ref names, timestamps and defaults over the repository. It deliberately does NOT yet
// materialise the durable git ref or inject a workspace into a sandbox — that is the
// IMaterialiser seam (Phase 2) and the sources work (Phase 5). Keeping those out of here
// means this layer stays pure and testable, and provision() is untouched for now.

import crypto from 'node:crypto';
import { IWorkspaceRepository } from '../../database/interfaces/IWorkspaceRepository';
import { WorkspaceRecord, WorkspaceSourceKind, WorkspacePersistence } from '../../database/models';

export interface CreateWorkspaceInput {
  name: string;
  ownerId: string;
  /** Defaults to 'blank'. 'git-url' requires sourceUrl. */
  source?: WorkspaceSourceKind;
  sourceUrl?: string;
  /** Defaults to 'persistent' (a named workspace shouldn't silently vanish). */
  persistence?: WorkspacePersistence;
}

export class WorkspaceManager {
  constructor(private repo: IWorkspaceRepository) {}

  /** Mint a new workspace record. The durable ref is materialised later (Phase 2/5). */
  public async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const source = input.source ?? 'blank';
    if (source === 'git-url' && !input.sourceUrl?.trim()) {
      throw new Error('A git-url workspace requires a sourceUrl.');
    }
    const id = `wsp-${crypto.randomUUID()}`;
    const now = Date.now();
    const record: WorkspaceRecord = {
      id,
      name: input.name?.trim() || 'Untitled workspace',
      ownerId: input.ownerId,
      ref: `refs/workspaces/${id}`,
      source,
      sourceUrl: input.sourceUrl?.trim() || undefined,
      persistence: input.persistence ?? 'persistent',
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(record);
    return record;
  }

  /** The caller's workspaces — what the /workspaces manager lists. */
  public list(ownerId: string): Promise<WorkspaceRecord[]> {
    return this.repo.listForOwner(ownerId);
  }

  public get(id: string): Promise<WorkspaceRecord | null> {
    return this.repo.get(id);
  }

  /**
   * Forget a workspace. Phase 1b removes only the record; once the durable ref exists
   * (Phase 2), pruning it belongs here too — reaped on an explicit delete, never as a
   * side effect of tearing a container down (same rule WorktreeEngine keeps for branches).
   */
  public async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
