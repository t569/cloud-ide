// Orchestrates a build: naming -> Dockerfile -> builder -> status tracking.
// The route talks only to this; it never knows about Docker, tags, or spawning.
import { EventEmitter } from 'events';
import { toImageName, toVersionedImageName } from '@cloud-ide/shared';
import { EnvironmentRecord } from '../../database/models';
import { DockerGeneratorService } from './GeneratorService';
import { BuilderRegistry } from './BuilderRegistry';
import { IBuildStore, BuildState } from './BuildTracker';
import { BuildProcess } from './IBuilder';

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

  /** Current status of every environment that has built (for the live poll). */
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
   * BuildConflictError if already building), generates the Dockerfile, and
   * returns a streaming handle. Status transitions are recorded automatically.
   */
  start(env: EnvironmentRecord, builderName?: string): BuildProcess {
    // Reserve first so a second concurrent call is rejected before we do work.
    this.store.begin(env.id);
    this.emitChange(env.id);
    try {
      // Content-addressed tag (immutable, enables rollback/cache) + moving :latest.
      const config = env.builderConfig;
      const versionedTag = config ? toVersionedImageName(env.id, config) : toImageName(env.id);
      const latestTag = toImageName(env.id);
      const imageTags = config ? [versionedTag, latestTag] : [latestTag];

      const dockerfile = DockerGeneratorService.generateDockerfile(JSON.stringify(env.builderConfig));

      const proc = this.builders.get(builderName).build(dockerfile, imageTags);
      this.active.set(env.id, proc);
      proc.on('succeeded', () => {
        this.active.delete(env.id);
        this.store.finish(env.id, true, { imageTag: versionedTag }); // record the immutable ref
        this.emitChange(env.id);
      });
      proc.on('failed', (message: string) => {
        this.active.delete(env.id);
        this.store.finish(env.id, false, { error: message });
        this.emitChange(env.id);
      });
      return proc;
    } catch (err) {
      // Synchronous failure (e.g. invalid config / unsafe id): release the slot.
      this.store.finish(env.id, false, { error: (err as Error).message });
      this.emitChange(env.id);
      throw err;
    }
  }

  /** Cancel a running build. Returns false if the env isn't currently building. */
  cancel(envId: string): boolean {
    const proc = this.active.get(envId);
    if (!proc) return false;
    proc.cancel(); // emits 'failed' -> listeners above clean up + record status
    return true;
  }
}
