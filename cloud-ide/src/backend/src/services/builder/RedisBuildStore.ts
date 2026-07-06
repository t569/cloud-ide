// Redis-backed build store. STUB: the code is complete against a minimal
// RedisLike client, but no Redis is running yet and no client is wired — so the
// factory (createBuildStore) still defaults to JSON. Drop in `ioredis`/`redis`
// (both satisfy RedisLike) and select it via BUILD_STORE=redis to activate.
//
// Same hybrid pattern as JsonBuildStore: InMemoryBuildStore owns the in-memory
// mirror (synchronous reads + concurrency guard); this subclass just swaps the
// durable backend from a file to a Redis key holding the JSON blob.
//
// ⚠️ Cluster caveat: because the guard reads the in-memory mirror, the per-env
// "already building" lock is PER-NODE. True multi-node exclusion needs an async
// IBuildStore + a Redis atomic lock (SET key val NX PX ...). Tracked in the
// builder README roadmap; single-node behaviour is correct today.
import { InMemoryBuildStore, BuildState } from './BuildTracker';

/** The subset of a Redis client we use. Satisfied by `ioredis` and `redis` v4. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export class RedisBuildStore extends InMemoryBuildStore {
  private writeChain: Promise<void> = Promise.resolve();
  /** Resolves once prior state has been loaded from Redis. */
  readonly ready: Promise<void>;

  constructor(
    private readonly client: RedisLike,
    private readonly key = 'cloud-ide:builds',
  ) {
    super();
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.client.get(this.key);
    } catch (e) {
      console.error('[RedisBuildStore] load failed:', e);
      return;
    }
    if (!raw) return; // first run / empty key
    let parsed: { records?: BuildState[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // corrupt blob — start clean rather than crash
    }
    if (this.hydrate(parsed.records ?? [])) this.changed();
  }

  protected changed(): void {
    // Serialise writes so rapid begin/finish can't race the SET.
    this.writeChain = this.writeChain
      .then(() => this.persist())
      .catch((e) => console.error('[RedisBuildStore] persist failed:', e));
  }

  private async persist(): Promise<void> {
    await this.client.set(this.key, this.serialize());
  }
}
