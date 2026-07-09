import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxRecord, SandboxState } from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../interfaces/ISandboxRepository';
import { writeJsonAtomic } from '../atomicWrite';

/**
 * Sandbox records, backed by one JSON file, held in memory.
 *
 * The file is read ONCE at boot; the in-memory map is authoritative thereafter and
 * every mutation writes through. This is not a cache — there is no invalidation,
 * because nothing else writes the file.
 *
 * Why it matters: `get()` is on the authorization hot path. Every guarded request
 * (`/api/fs/:id/*`, and `/preview/:id/:port` for EVERY proxied asset) calls
 * `userOwnsSandbox` → `get()`. Re-reading and `JSON.parse`-ing the whole DB per
 * request cost ~0.9ms of *synchronous, event-loop-blocking* work at 200 sandboxes,
 * scaling with total DB size rather than with the caller. A page load pulling 50
 * assets through the proxy stalled the loop for ~45ms on ownership checks alone.
 * In memory it is a map lookup.
 *
 * Writes are atomic (`writeJsonAtomic`: temp file + rename) and serialized on a
 * promise chain. The old plain `fs.writeFile` could truncate `sandboxes.json` on a
 * crash mid-write — losing every record — and two concurrent read-modify-write
 * cycles could silently drop one of the two updates.
 *
 * ponytail: single-node assumption, the same one the gateway makes everywhere
 * (FsEventHub's pub/sub, WorkspaceWatchers' ref-count, the worktrees on local disk).
 * The moment a second node exists this becomes Redis/Postgres BEHIND THE SAME
 * ISandboxRepository interface — that seam is why this file can be this dumb.
 */
export class JsonSandboxRepository implements ISandboxRepository {
  private filePath: string;
  private readonly ready: Promise<void>;
  private db: Record<string, SandboxRecord> = {};
  /** Serializes writes: a mutation never overlaps the previous one's rename. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDirectory: string = './data') {
    this.filePath = path.join(storageDirectory, 'sandboxes.json');
    this.ready = this.load();
  }

  /**
   * Read the file once, at boot.
   *
   * A missing file is normal (first run) — start empty. A file that exists but does
   * not parse is NOT normal, and must never be overwritten with `{}`: it is the only
   * index from containers to worktrees, so clobbering it orphans every running
   * sandbox and its uncommitted work. Move it aside, keep it, and start empty so the
   * gateway still boots. The atomic rename in `flush()` means corruption can no
   * longer originate here, so this is about surviving damage from outside.
   */
  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err; // permissions, EIO — fail loud, don't guess
      this.db = {};
      await writeJsonAtomic(this.filePath, this.db);
      return;
    }

    try {
      this.db = JSON.parse(raw);
    } catch (err: any) {
      const quarantine = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.rename(this.filePath, quarantine);
      console.error(
        `[SandboxRepo] ${this.filePath} is not valid JSON (${err.message}). ` +
          `Preserved at ${quarantine}; starting empty. Running sandboxes are now orphaned — ` +
          `recover ids from that file, or let IdleSweeper prune the containers.`,
      );
      this.db = {};
      await writeJsonAtomic(this.filePath, this.db);
    }
  }

  /** Persist the current map. Chained so concurrent mutations can't interleave. */
  private flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => writeJsonAtomic(this.filePath, this.db));
    return this.writeQueue;
  }

  public async save(sandbox: SandboxRecord): Promise<void> {
    await this.ready;
    this.db[sandbox.sandboxId] = sandbox;
    await this.flush();
  }

  /**
   * Hands back a copy, never the stored object. Reading a record used to mean a
   * fresh JSON.parse, so a caller who mutated the result changed nothing; returning
   * the live reference would silently corrupt the store instead. Every caller today
   * rebuilds with `{ ...record }`, but discipline is not a guarantee.
   *
   * ponytail: shallow — `desiredVolumes` is still shared by reference. Callers
   * replace that array (filter/spread), never push into it. Deep-clone or freeze if
   * that ever stops being true.
   */
  public async get(sandboxId: string): Promise<SandboxRecord | null> {
    await this.ready;
    const record = this.db[sandboxId];
    return record ? { ...record } : null;
  }

  public async delete(sandboxId: string): Promise<void> {
    await this.ready;
    delete this.db[sandboxId];
    await this.flush();
  }

  public async updateState(sandboxId: string, state: SandboxState): Promise<void> {
    await this.ready;
    const record = this.db[sandboxId];
    if (!record) return;
    this.db[sandboxId] = { ...record, state };
    await this.flush();
  }

  public async getSandboxesByEnvId(envId: string): Promise<SandboxRecord[]> {
    await this.ready;
    return Object.values(this.db)
      .filter((sandbox) => sandbox.environmentId === envId)
      .map((sandbox) => ({ ...sandbox }));
  }

  public async list(): Promise<SandboxRecord[]> {
    await this.ready;
    return Object.values(this.db).map((sandbox) => ({ ...sandbox }));
  }
}
