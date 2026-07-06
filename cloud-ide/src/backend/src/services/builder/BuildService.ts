// Orchestrates a build: naming -> Dockerfile -> builder -> status tracking.
// The route talks only to this; it never knows about Docker, tags, or spawning.
import { EventEmitter } from 'events';
import { toImageName, toVersionedImageName } from '@cloud-ide/shared';
import { EnvironmentRecord } from '../../database/models';
import { DockerGeneratorService } from './GeneratorService';
import { BuilderRegistry } from './BuilderRegistry';
import { IBuildStore, BuildState } from './BuildTracker';
import { BuildProcess } from './IBuilder';

// A BuildProcess that emits canned output then settles — for a cache hit, where
// there's nothing to spawn but the route still streams a result.
class InstantBuildProcess extends EventEmitter implements BuildProcess {
  constructor(lines: string[], outcome: 'succeeded' | 'failed', message: string) {
    super();
    setImmediate(() => {
      for (const line of lines) this.emit('data', line);
      this.emit(outcome, message);
    });
  }
  cancel(): void {
    /* nothing running */
  }
}

export class BuildService {
  // Live handles to running builds, so an out-of-band request can cancel them.
  private readonly active = new Map<string, BuildProcess>();
  // Status-change bus for SSE subscribers (one listener per connected client).
  private readonly events = new EventEmitter();

  constructor(
    private readonly builders: BuilderRegistry,
    private readonly store: IBuildStore,
  ) {
    this.events.setMaxListeners(0); // unbounded SSE clients
  }

  /** Subscribe to status changes (SSE). */
  onChange(cb: (state: BuildState) => void): void {
    this.events.on('change', cb);
  }
  offChange(cb: (state: BuildState) => void): void {
    this.events.off('change', cb);
  }
  private emitChange(envId: string): void {
    const state = this.store.get(envId);
    if (state) this.events.emit('change', state);
  }

  status(envId: string) {
    return this.store.get(envId);
  }

  /** Current status of every environment that has built (snapshot for SSE/REST). */
  allStatuses() {
    return this.store.all();
  }

  /** Build history, newest-first; all environments or one. */
  history(envId?: string) {
    return this.store.history(envId);
  }

  isBuilding(envId: string): boolean {
    return this.store.isBuilding(envId);
  }

  /**
   * Start building an environment. Reserves the concurrency slot (throws
   * BuildConflictError if already building). If the content-addressed image
   * already exists, retags :latest and skips the rebuild. Otherwise generates
   * the Dockerfile and streams a real build. Status is recorded automatically.
   */
  async start(env: EnvironmentRecord, builderName?: string): Promise<BuildProcess> {
    // Reserve first (sync, before any await) so a concurrent call is rejected.
    this.store.begin(env.id);
    this.emitChange(env.id);
    try {
      const config = env.builderConfig;
      const latestTag = toImageName(env.id);
      const versionedTag = config ? toVersionedImageName(env.id, config) : latestTag;
      const builder = this.builders.get(builderName);

      // Cache hit: this exact content is already built. Point :latest at it and
      // skip the (potentially long) rebuild entirely.
      if (config && builder.exists && builder.tag && (await builder.exists(versionedTag))) {
        await builder.tag(versionedTag, latestTag);
        const proc = new InstantBuildProcess(
          [`\x1b[1;36m[Cache]\x1b[0m ${versionedTag} already built — skipping rebuild.\n`],
          'succeeded',
          `Reused cached image ${versionedTag}`,
        );
        this.wire(env.id, proc, versionedTag);
        return proc;
      }

      const dockerfile = DockerGeneratorService.generateDockerfile(JSON.stringify(config));
      const proc = builder.build(dockerfile, config ? [versionedTag, latestTag] : [latestTag]);
      this.wire(env.id, proc, versionedTag);
      return proc;
    } catch (err) {
      // Synchronous/async failure before streaming: release the slot.
      this.store.finish(env.id, false, { error: (err as Error).message });
      this.emitChange(env.id);
      throw err;
    }
  }

  // Record status transitions + track the live handle for cancellation.
  private wire(envId: string, proc: BuildProcess, versionedTag: string): void {
    this.active.set(envId, proc);
    proc.on('succeeded', () => {
      this.active.delete(envId);
      this.store.finish(envId, true, { imageTag: versionedTag }); // immutable ref
      this.emitChange(envId);
    });
    proc.on('failed', (message: string) => {
      this.active.delete(envId);
      this.store.finish(envId, false, { error: message });
      this.emitChange(envId);
    });
  }

  /** Cancel a running build. Returns false if the env isn't currently building. */
  cancel(envId: string): boolean {
    const proc = this.active.get(envId);
    if (!proc) return false;
    proc.cancel(); // emits 'failed' -> listeners above clean up + record status
    return true;
  }

  /**
   * Roll back / deploy: point :latest at an existing content-addressed image.
   * Throws if the image is gone or the builder can't retag.
   */
  async deploy(envId: string, imageTag: string, builderName?: string): Promise<void> {
    const builder = this.builders.get(builderName);
    if (!builder.tag) throw new Error(`Builder "${builder.name}" cannot retag images`);
    if (builder.exists && !(await builder.exists(imageTag))) {
      throw new Error(`Image ${imageTag} not found — it may have been pruned`);
    }
    await builder.tag(imageTag, toImageName(envId));
  }
}
