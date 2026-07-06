// Orchestrates a build: naming -> Dockerfile -> builder -> status tracking.
// The route talks only to this; it never knows about Docker, tags, or spawning.
import { toImageName } from '@cloud-ide/shared';
import { EnvironmentRecord } from '../../database/models';
import { DockerGeneratorService } from './GeneratorService';
import { BuilderRegistry } from './BuilderRegistry';
import { IBuildStore } from './BuildTracker';
import { BuildProcess } from './IBuilder';

export class BuildService {
  constructor(
    private readonly builders: BuilderRegistry,
    private readonly store: IBuildStore,
  ) {}

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
    try {
      const imageTag = toImageName(env.id); // rename-stable, id-based
      const dockerfile = DockerGeneratorService.generateDockerfile(JSON.stringify(env.builderConfig));

      const proc = this.builders.get(builderName).build(dockerfile, imageTag);
      proc.on('succeeded', () => this.store.finish(env.id, true, { imageTag }));
      proc.on('failed', (message: string) => this.store.finish(env.id, false, { error: message }));
      return proc;
    } catch (err) {
      // Synchronous failure (e.g. invalid config / unsafe id): release the slot.
      this.store.finish(env.id, false, { error: (err as Error).message });
      throw err;
    }
  }
}
