// Orchestrates a build: naming -> Dockerfile -> queue -> builder -> status.
// The route talks only to this; it never knows about Docker, tags, or spawning.
import { EventEmitter } from 'events';
import { toImageName, toVersionedImageName, stripRegistry } from '@cloud-ide/shared';
import { EnvironmentRecord } from '../../database/models';
import { DockerGeneratorService } from './GeneratorService';
import { BuilderRegistry } from './BuilderRegistry';
import { IBuildStore, BuildState } from './BuildStore';
import { IBuilder, BuildProcess, BuildOptions } from './IBuilder';

// Counting semaphore: caps how many builds run at once. release() hands the slot
// straight to the next waiter (FIFO), so `active` stays balanced.
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  get waiting(): number {
    return this.waiters.length;
  }
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // pass the slot on; active unchanged
    else this.active = Math.max(0, this.active - 1);
  }
}

// A BuildProcess that emits canned output then settles — for a cache hit.
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

// Handle returned to the route immediately, before a queue slot is free. It can
// stream "queued" notices, then forwards a real build's events once attached.
class RelayBuildProcess extends EventEmitter implements BuildProcess {
  private source?: BuildProcess;
  private cancelled = false;
  get isCancelled(): boolean {
    return this.cancelled;
  }
  push(line: string): void {
    this.emit('data', line);
  }
  attach(source: BuildProcess): void {
    this.source = source;
    source.on('data', (d) => this.emit('data', d));
    source.on('succeeded', (m) => this.emit('succeeded', m));
    source.on('failed', (m) => this.emit('failed', m));
  }
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.source) this.source.cancel();
    else this.emit('failed', 'Build cancelled'); // cancelled while still queued
  }
}

// Chains build -> push into ONE BuildProcess, so BuildService.wire/relay stay
// untouched and the queue slot is held across both phases. Build failure => the
// whole thing fails, no push. Build success => push the immutable tag; the push
// outcome becomes the outcome, so push-fail fails the build (the image is
// local-only, not cluster-deployable). Only constructed when a registry is set.
class PushingBuild extends EventEmitter implements BuildProcess {
  private phase: BuildProcess; // the currently-live child, for cancel routing
  private cancelled = false;
  constructor(
    build: BuildProcess,
    private readonly builder: IBuilder,
    private readonly pushTag: string,
  ) {
    super();
    this.phase = build;
    build.on('data', (d) => this.emit('data', d));
    build.on('failed', (m) => this.emit('failed', m));
    build.on('succeeded', () => this.startPush());
  }
  private startPush(): void {
    if (this.cancelled) return;
    const push = this.builder.push!(this.pushTag);
    this.phase = push;
    push.on('data', (d) => this.emit('data', d));
    push.on('succeeded', (m) => this.emit('succeeded', m));
    push.on('failed', (m) => this.emit('failed', m));
  }
  cancel(): void {
    this.cancelled = true;
    this.phase.cancel();
  }
}

export class BuildService {
  // Live handles to running builds, so an out-of-band request can cancel them.
  private readonly active = new Map<string, BuildProcess>();
  // Status-change bus for SSE subscribers (one listener per connected client).
  private readonly events = new EventEmitter();
  // Global build concurrency limit (per-env duplicates are blocked separately).
  private readonly queue: Semaphore;

  constructor(
    private readonly builders: BuilderRegistry,
    private readonly store: IBuildStore,
    maxConcurrent = 2,
  ) {
    this.events.setMaxListeners(0);
    this.queue = new Semaphore(Math.max(1, maxConcurrent));
  }

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
  allStatuses() {
    return this.store.all();
  }
  history(envId?: string) {
    return this.store.history(envId);
  }
  isBuilding(envId: string): boolean {
    return this.store.isBuilding(envId);
  }

  /**
   * Start building an environment. Reserves the per-env slot (throws
   * BuildConflictError if one is active). Cache hits skip everything. Otherwise
   * the real build is queued behind the global concurrency limit; the returned
   * handle streams "queued" notices until a slot frees, then the build logs.
   */
  async start(env: EnvironmentRecord, builderName?: string): Promise<BuildProcess> {
    this.store.begin(env.id); // reserve as 'queued' (sync, before any await)
    this.emitChange(env.id);
    try {
      const config = env.builderConfig;
      const latestTag = toImageName(env.id);
      const versionedTag = config ? toVersionedImageName(env.id, config) : latestTag;
      const builder = this.builders.get(builderName);

      // Cache hit: already built — retag :latest, skip queue + rebuild.
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

      // Generate now (validates config) so we fail fast before holding a slot.
      const dockerfile = DockerGeneratorService.generateDockerfile(JSON.stringify(config));
      const imageTags = config ? [versionedTag, latestTag] : [latestTag];

      const relay = new RelayBuildProcess();
      this.wire(env.id, relay, versionedTag);
      // config.timeout is seconds; a hung build must not hold a queue slot forever.
      const timeoutMs = config?.timeout ? config.timeout * 1000 : undefined;
      // v1: push the immutable versioned tag, and only when a registry qualified
      // it (unset => bare tag, stripRegistry is a no-op => skip push, zero change).
      const pushTag =
        config && stripRegistry(versionedTag) !== versionedTag ? versionedTag : undefined;
      this.enqueue(
        env.id,
        relay,
        builder,
        dockerfile,
        imageTags,
        { timeoutMs, platform: config?.platform },
        pushTag,
      );
      return relay;
    } catch (err) {
      this.store.finish(env.id, false, { error: (err as Error).message });
      this.emitChange(env.id);
      throw err;
    }
  }

  // Wait for a global build slot, then run the real build and forward it.
  private enqueue(
    envId: string,
    relay: RelayBuildProcess,
    builder: IBuilder,
    dockerfile: string,
    imageTags: string[],
    opts: BuildOptions,
    pushTag?: string,
  ): void {
    const ahead = this.queue.waiting;
    if (ahead > 0 && !relay.isCancelled) {
      relay.push(`\x1b[1;33m[Queue]\x1b[0m Waiting for a build slot (${ahead} ahead)...\n`);
    }

    void this.queue.acquire().then(() => {
      if (relay.isCancelled) {
        this.queue.release(); // cancelled while queued — give the slot back
        return;
      }
      this.store.markRunning(envId);
      this.emitChange(envId);

      // Chain a push onto build when a registry is configured; the slot is held
      // across both so a push can't be starved out from under a "succeeded".
      const real = builder.build(dockerfile, imageTags, opts);
      const proc = pushTag && builder.push ? new PushingBuild(real, builder, pushTag) : real;
      const release = () => this.queue.release();
      proc.on('succeeded', release);
      proc.on('failed', release);
      relay.attach(proc);
    });
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

  /** Cancel a running or queued build. Returns false if the env isn't active. */

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
