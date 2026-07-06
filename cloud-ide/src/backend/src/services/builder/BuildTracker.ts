// Build status, history, and concurrency guard. IBuildStore is the swap
// boundary. Implementations:
//   InMemoryBuildStore — fast, volatile (tests, ephemeral). Also the base for
//                        durable stores: it owns the in-memory mirror that backs
//                        the SYNCHRONOUS reads + concurrency guard, and exposes
//                        hydrate()/serialize() so a subclass only adds I/O.
//   JsonBuildStore     — mirror + durable JSON file (here).
//   RedisBuildStore    — mirror + durable Redis blob (RedisBuildStore.ts).
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from '../../database/atomicWrite';

export type BuildStatus = 'queued' | 'building' | 'succeeded' | 'failed';

export interface BuildState {
  buildId: string;
  envId: string;
  status: BuildStatus;
  imageTag?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface IBuildStore {
  /** Latest state for an env (undefined if it never built). */
  get(envId: string): BuildState | undefined;
  isBuilding(envId: string): boolean;
  /** Reserve a build (status 'queued'). Throws BuildConflictError if one is active. */
  begin(envId: string): void;
  /** Transition a reserved build from 'queued' to 'building' (slot acquired). */
  markRunning(envId: string): void;
  finish(envId: string, ok: boolean, detail: { imageTag?: string; error?: string }): void;
  /** Current state of every env that has built (for the live status poll). */
  all(): BuildState[];
  /** Build history, newest-first; all envs or one. */
  history(envId?: string): BuildState[];
}

/** Thrown by begin() when an environment already has a build in progress (HTTP 409). */
export class BuildConflictError extends Error {
  constructor(envId: string) {
    super(`Environment "${envId}" already has a build in progress`);
    this.name = 'BuildConflictError';
  }
}

const MAX_HISTORY = 200;
const INTERRUPTED = 'Interrupted by a server restart';
let seq = 0;
const newBuildId = (): string => `b-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export class InMemoryBuildStore implements IBuildStore {
  // states: latest per env (source of truth for the sync concurrency guard).
  // records: newest-first history, holding the SAME object refs as states — so
  // mutating a state in finish() updates history too.
  protected states = new Map<string, BuildState>();
  protected records: BuildState[] = [];

  /** Persistence hook — no-op in memory, overridden by JsonBuildStore. */
  protected changed(): void {}

  get(envId: string): BuildState | undefined {
    return this.states.get(envId);
  }

  isBuilding(envId: string): boolean {
    return this.states.get(envId)?.status === 'building';
  }

  // Active = reserved but not finished (queued or building) — the guard scope.
  private isActive(envId: string): boolean {
    const s = this.states.get(envId)?.status;
    return s === 'queued' || s === 'building';
  }

  all(): BuildState[] {
    return [...this.states.values()];
  }

  history(envId?: string): BuildState[] {
    return envId ? this.records.filter((r) => r.envId === envId) : [...this.records];
  }

  begin(envId: string): void {
    if (this.isActive(envId)) throw new BuildConflictError(envId);
    const state: BuildState = { buildId: newBuildId(), envId, status: 'queued', startedAt: Date.now() };
    this.states.set(envId, state);
    this.records.unshift(state);
    if (this.records.length > MAX_HISTORY) this.records.length = MAX_HISTORY;
    this.changed();
  }

  markRunning(envId: string): void {
    const state = this.states.get(envId);
    if (state && state.status === 'queued') {
      state.status = 'building';
      this.changed();
    }
  }

  finish(envId: string, ok: boolean, detail: { imageTag?: string; error?: string }): void {
    const state = this.states.get(envId);
    if (!state) return;
    state.status = ok ? 'succeeded' : 'failed';
    state.finishedAt = Date.now();
    if (detail.imageTag !== undefined) state.imageTag = detail.imageTag;
    if (detail.error !== undefined) state.error = detail.error;
    this.changed();
  }

  // ---- shared persistence helpers (used by durable subclasses) -------------

  /**
   * Load persisted records into the in-memory mirror, reconciling any build left
   * queued/building by a crash (→ failed). Returns true if anything changed, so
   * the caller can re-persist. Shared by JsonBuildStore + RedisBuildStore.
   */
  protected hydrate(records: BuildState[]): boolean {
    let reconciled = false;
    for (const r of records) {
      if (r.status === 'building' || r.status === 'queued') {
        r.status = 'failed';
        r.error = r.error ?? INTERRUPTED;
        r.finishedAt = r.finishedAt ?? Date.now();
        reconciled = true;
      }
    }
    this.records = records.slice(0, MAX_HISTORY);
    this.states.clear();
    for (const r of this.records) if (!this.states.has(r.envId)) this.states.set(r.envId, r); // newest-first wins
    return reconciled;
  }

  /** Serialise the durable payload (history is the source; state is derived). */
  protected serialize(): string {
    return JSON.stringify({ records: this.records });
  }
}

export class JsonBuildStore extends InMemoryBuildStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();
  /** Resolves once prior state has been loaded from disk. */
  readonly ready: Promise<void>;

  constructor(storageDirectory = './data') {
    super();
    this.filePath = path.join(storageDirectory, 'builds.json');
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    let raw: { records?: BuildState[] };
    try {
      raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
    } catch {
      return; // no file yet — first run
    }
    if (this.hydrate(raw.records ?? [])) this.changed();
  }

  protected changed(): void {
    // Serialise writes so rapid begin/finish can't interleave a partial file.
    this.writeChain = this.writeChain
      .then(() => this.persist())
      .catch((e) => console.error('[JsonBuildStore] persist failed:', e));
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.filePath, { records: this.records });
  }
}
