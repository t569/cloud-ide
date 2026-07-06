// Build status + concurrency guard. IBuildStore is the swap boundary: swap the
// in-memory map for Redis/DB persistence without touching BuildService.
export type BuildStatus = 'building' | 'succeeded' | 'failed';

export interface BuildState {
  envId: string;
  status: BuildStatus;
  imageTag?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface IBuildStore {
  get(envId: string): BuildState | undefined;
  isBuilding(envId: string): boolean;
  /** Mark a build as started. Throws BuildConflictError if one is already running. */
  begin(envId: string): void;
  finish(envId: string, ok: boolean, detail: { imageTag?: string; error?: string }): void;
}

/** Thrown by begin() when an environment is already building (maps to HTTP 409). */
export class BuildConflictError extends Error {
  constructor(envId: string) {
    super(`Environment "${envId}" is already building`);
    this.name = 'BuildConflictError';
  }
}

export class InMemoryBuildStore implements IBuildStore {
  private readonly states = new Map<string, BuildState>();

  get(envId: string): BuildState | undefined {
    return this.states.get(envId);
  }

  isBuilding(envId: string): boolean {
    return this.states.get(envId)?.status === 'building';
  }

  begin(envId: string): void {
    if (this.isBuilding(envId)) throw new BuildConflictError(envId);
    this.states.set(envId, { envId, status: 'building', startedAt: Date.now() });
  }

  finish(envId: string, ok: boolean, detail: { imageTag?: string; error?: string }): void {
    const prev = this.states.get(envId);
    this.states.set(envId, {
      envId,
      status: ok ? 'succeeded' : 'failed',
      startedAt: prev?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
      imageTag: detail.imageTag,
      error: detail.error,
    });
  }
}
