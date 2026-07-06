// Build status, history, and concurrency guard. IBuildStore is the swap
// boundary. Two implementations here:
//   InMemoryBuildStore — fast, volatile (tests, ephemeral).
//   JsonBuildStore     — same logic + durable JSON persistence + restart
//                        reconciliation, so status/history survive restarts.
import fs from 'node:fs/promises';
import path from 'node:path';

export type BuildStatus = 'building' | 'succeeded' | 'failed';

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
  /** Reserve the build slot. Throws BuildConflictError if already building. */
  begin(envId: string): void;
  finish(envId: string, ok: boolean, detail: { imageTag?: string; error?: string }): void;
  /** Current state of every env that has built (for the live status poll). */
  all(): BuildState[];
  /** Build history, newest-first; all envs or one. */
  history(envId?: string): BuildState[];
}

/** Thrown by begin() when an environment is already building (maps to HTTP 409). */
export class BuildConflictError extends Error {
  constructor(envId: string) {
    super(`Environment "${envId}" is already building`);
    this.name = 'BuildConflictError';
  }
}

const MAX_HISTORY = 200;
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

  all(): BuildState[] {
    return [...this.states.values()];
  }

  history(envId?: string): BuildState[] {
    return envId ? this.records.filter((r) => r.envId === envId) : [...this.records];
  }

  begin(envId: string): void {
    if (this.isBuilding(envId)) throw new BuildConflictError(envId);
    const state: BuildState = { buildId: newBuildId(), envId, status: 'building', startedAt: Date.now() };
    this.states.set(envId, state);
    this.records.unshift(state);
    if (this.records.length > MAX_HISTORY) this.records.length = MAX_HISTORY;
    this.changed();
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
}

const INTERRUPTED = 'Interrupted by a server restart';

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
    const records = raw.records ?? [];
    let reconciled = false;
    for (const r of records) {
      // Any build still "building" means the process died mid-build.
      if (r.status === 'building') {
        r.status = 'failed';
        r.error = r.error ?? INTERRUPTED;
        r.finishedAt = r.finishedAt ?? Date.now();
        reconciled = true;
      }
    }
    this.records = records.slice(0, MAX_HISTORY);
    this.states.clear();
    for (const r of this.records) if (!this.states.has(r.envId)) this.states.set(r.envId, r); // newest-first wins
    if (reconciled) this.changed();
  }

  protected changed(): void {
    // Serialise writes so rapid begin/finish can't interleave a partial file.
    this.writeChain = this.writeChain
      .then(() => this.persist())
      .catch((e) => console.error('[BuildStore] persist failed:', e));
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2));
  }
}
