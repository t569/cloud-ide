// backend/src/database/json/JsonWorkspaceRepository.ts
//
// Workspaces on disk (docs/plans/workspace-entity.md). Same two rules as the other JSON
// repos, for the same reasons: writes are ATOMIC (temp file + rename) so a reader never
// sees a torn file, and read-modify-write is SERIALIZED so two overlapping mutations don't
// lose each other's record. Unlike sessions/sandboxes, these records are DURABLE — they
// outlive the containers they attach to — so losing this file loses real user state.
import fs from 'node:fs/promises';
import path from 'node:path';
import { IWorkspaceRepository } from '../interfaces/IWorkspaceRepository';
import { WorkspaceRecord } from '../models';
import { DATA_DIR } from '../../config/paths';
import { writeJsonAtomic } from '../atomicWrite';

export class JsonWorkspaceRepository implements IWorkspaceRepository {
  private filePath: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storageDirectory: string = DATA_DIR) {
    this.filePath = path.join(storageDirectory, 'workspaces.json');
  }

  private async read(): Promise<Record<string, WorkspaceRecord>> {
    const raw = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      console.warn('[JsonWorkspaceRepository] workspaces.json is unreadable; starting empty.');
      return {};
    }
  }

  /** Runs `fn` after every mutation queued before it. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private mutate(fn: (db: Record<string, WorkspaceRecord>) => void): Promise<void> {
    return this.serialize(async () => {
      const db = await this.read();
      fn(db);
      await writeJsonAtomic(this.filePath, db);
    });
  }

  public async save(workspace: WorkspaceRecord): Promise<void> {
    await this.mutate((db) => {
      db[workspace.id] = workspace;
    });
  }

  public async get(workspaceId: string): Promise<WorkspaceRecord | null> {
    const db = await this.read();
    return db[workspaceId] ?? null;
  }

  public async delete(workspaceId: string): Promise<void> {
    await this.mutate((db) => {
      delete db[workspaceId];
    });
  }

  public async list(): Promise<WorkspaceRecord[]> {
    return Object.values(await this.read());
  }

  public async listForOwner(ownerId: string): Promise<WorkspaceRecord[]> {
    const all = await this.list();
    // Ownerless records are adoptable, matching the sandbox legacy-adoption rule.
    return all.filter((w) => !w.ownerId || w.ownerId === ownerId);
  }
}
