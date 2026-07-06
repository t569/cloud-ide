// The single place that decides which IBuildStore backs the build pipeline.
// Config-driven so swapping persistence never touches BuildService or the routes.
import { IBuildStore, InMemoryBuildStore, JsonBuildStore } from './BuildTracker';
import { RedisBuildStore, RedisLike } from './RedisBuildStore';

export interface BuildStoreOptions {
  /** Backend: 'json' (default) | 'memory' | 'redis'. Falls back to $BUILD_STORE. */
  backend?: string;
  /** Directory for the JSON backend (default './data'). */
  dataDir?: string;
  /** Redis client — required when backend === 'redis'. */
  redis?: RedisLike;
}

export function createBuildStore(opts: BuildStoreOptions = {}): IBuildStore {
  const backend = (opts.backend ?? process.env.BUILD_STORE ?? 'json').toLowerCase();

  switch (backend) {
    case 'memory':
      return new InMemoryBuildStore();

    case 'redis':
      if (!opts.redis) {
        // Redis isn't running / no client wired yet — fail loudly rather than
        // silently persisting nowhere. Wire a client in server.ts to enable it.
        throw new Error(
          "BUILD_STORE=redis but no Redis client was provided. Pass { redis } to " +
            'createBuildStore() in server.ts (see services/builder/README.md).',
        );
      }
      return new RedisBuildStore(opts.redis);

    case 'json':
    default:
      return new JsonBuildStore(opts.dataDir);
  }
}
