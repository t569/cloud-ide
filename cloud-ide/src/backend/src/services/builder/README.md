# 🐳 Build Pipeline (`services/builder`)

The build subsystem turns a saved environment's JSON config into a running Docker
image, and tracks the build's lifecycle. It has **two decoupled layers**:

| Layer | Job | Entry point |
|---|---|---|
| **Generation** | JSON config → optimized Dockerfile string | `DockerGeneratorService` |
| **Orchestration** | Dockerfile → built/tagged image, with status, queueing, history | `BuildService` |

The HTTP routes (`api/routes/environment.routes.ts`) talk **only** to `BuildService`
— they never spawn Docker, compute tags, or touch persistence directly.

---

## 📂 File map

```
services/builder/
  GeneratorService.ts     # Layer A: JSON -> Dockerfile (delegates to /pipeline)
  IBuilder.ts             # Layer B: builder interface (build / exists / tag)
  DockerBuilder.ts        #          Docker implementation of IBuilder
  BuilderRegistry.ts      #          name -> IBuilder (swap the build backend)
  BuildService.ts         #          the conductor: naming, queue, cache, status
  BuildStore.ts           #          IBuildStore + InMemory/Json stores, status types
  RedisBuildStore.ts      #          Redis store (STUB — see "Persistence")
  createBuildStore.ts     #          config-driven store factory ($BUILD_STORE)
  GarbageCollector.ts     #          nightly `docker prune`
```
Naming/validity (ids, slugs, content hash, image tags) lives in
`@cloud-ide/shared/utils/naming.ts` — the single source shared with the frontend.

---

## Layer A — Dockerfile Generation

`DockerGeneratorService.generateDockerfile(jsonString)` runs a 5-phase pipeline
(implemented under `/pipeline`, documented separately):

1. **Validation** (`shared/utils/Validator.ts`) — shell-injection scan, dependency
   ordering, reserved-path protection, redundancy checks.
2. **Multi-stage orchestration** — heavy managers (npm/cargo/pip) to a builder
   stage, runtime deps to the final stage, `COPY --from=builder` bridges.
3. **Middleware injection** — `SecurityUserInjector` (drop root),
   `OpenSandboxInjector` (control-plane daemon).
4. **Step translation** (`PackageManagerRules`) — BuildKit cache mounts.
5. **Assembly** — `# syntax=docker/dockerfile:1.4`, layer flattening.

👉 Deep dive: **[/pipeline/README.md](../../../../pipeline/README.md)**

---

## Layer B — Build Orchestration

### The conductor: `BuildService`

`start(env)` runs this flow (returns a streaming handle immediately):

1. **Reserve** the per-env slot in the store (`begin` → status `queued`). A second
   build of the same env throws `BuildConflictError` → **HTTP 409**.
2. **Compute tags** via shared naming: a content-addressed
   `cloud-ide-<id>:<hash>` **and** the moving `cloud-ide-<id>:latest`.
3. **Cache-hit skip** — if the content tag already exists (`builder.exists`),
   retag `:latest` onto it (`builder.tag`) and return an instant "reused cached
   image" result. No rebuild.
4. **Queue** the real build behind the global concurrency limit (below). While
   waiting, the handle streams `[Queue] waiting for a slot…`.
5. **Build** — `builder.build(dockerfile, [versioned, latest])`. Logs stream to
   the client; status → `building` → `succeeded`/`failed`.

Other operations:
- `cancel(envId)` — stops a running **or** queued build (SIGTERM to docker; a
  queued build fails immediately and releases its slot on acquire).
- `deploy(envId, imageTag)` — **rollback**: verify the image exists, then point
  `:latest` at it. History rows carry immutable content tags, so this is a cheap
  retag, not a rebuild.

### Swappable build backend: `IBuilder` + `BuilderRegistry`

```ts
interface IBuilder {
  name: string;
  build(dockerfile: string, imageTags: string[]): BuildProcess; // emits data/succeeded/failed
  exists?(imageTag: string): Promise<boolean>; // cache-hit probe
  tag?(source: string, target: string): Promise<void>; // retag (latest / rollback)
}
```
`DockerBuilder` is the only implementation today. To swap in BuildKit/Kaniko/a
remote build farm, implement `IBuilder` and register it:
`new BuilderRegistry([new DockerBuilder(), new MyBuilder()], 'mybuilder')`.

> `BuildProcess` deliberately emits `succeeded`/`failed` — **not** the reserved
> Node `'error'` event, whose missing-listener throw is a footgun.

### Build queue (concurrency)

A counting `Semaphore` inside `BuildService` caps how many builds run at once
(`MAX_CONCURRENT_BUILDS`, default **2**). The per-env guard still blocks duplicate
builds of the same env. Over-limit builds sit in status `queued`; a
`RelayBuildProcess` streams queue notices, then forwards the real build's logs
once a slot frees. Cache hits bypass the queue entirely.

### Status & history: `IBuildStore`

`IBuildStore` is the persistence seam. The in-memory mirror backs the
**synchronous** reads and concurrency guard; durable stores add I/O on top.

| Store | Durability | Notes |
|---|---|---|
| `InMemoryBuildStore` | none | tests / ephemeral; base for the others |
| `JsonBuildStore` | `data/builds.json` | **default**; atomic writes; restart reconciliation |
| `RedisBuildStore` | Redis key | **stub** — complete code, not wired (no Redis yet) |

Selected by `createBuildStore()` (see **Persistence** below).

**Status lifecycle** (`BuildState.status`):

```
begin()        markRunning()        finish(ok)
  │                │                    │
queued ──────► building ──────► succeeded | failed
```
- `startedAt` / `finishedAt` timestamps, `imageTag` (content tag on success),
  `error` (on failure), `buildId`.
- **Restart reconciliation**: a store loading records left `queued`/`building`
  (process died mid-build) marks them `failed` — no zombie "building forever".
- History is capped at 200 records, newest-first.

### Live updates (SSE)

`BuildService` is a status event bus. `GET /events` sends a `snapshot` on connect,
then a `change` per transition. The frontend `EventSource` auto-reconnects and the
snapshot self-heals — no polling.

### Content-addressed image tags

`contentTag(config)` (shared) is a deterministic FNV-1a hash over a canonical
projection of the config (step order significant; package/env order not). Each
build tags `:<hash>` (immutable — enables rollback + cache identity) and `:latest`
(moving pointer). Non-cryptographic; collision-negligible at realistic scale.

---

## 🌐 HTTP API (`/api/environment`)

| Method + path | Purpose |
|---|---|
| `GET /` | list environments |
| `POST /` | create (mints id) → 201 |
| `PUT /:id` | update (identity immutable) |
| `DELETE /:id` | delete (409 if sessions use it) |
| `POST /:id/build` | build (streams logs; 409 if already active) |
| `POST /:id/build/cancel` | cancel a running/queued build |
| `POST /:id/rollback` | `{ imageTag }` → point `:latest` at a prior build |
| `GET /:id/status` | current status for one env |
| `GET /:id/builds` | build history for one env |
| `GET /statuses` | current status of all envs (REST snapshot) |
| `GET /events` | live status stream (SSE) |

---

## ⚙️ Persistence & configuration

The store is chosen by `createBuildStore()`:

```ts
// server.ts (default — JSON on disk)
const store = createBuildStore();

// switch backends without touching BuildService or the routes:
createBuildStore({ backend: 'memory' });                 // volatile
createBuildStore({ backend: 'redis', redis: myClient }); // Redis (needs a client)
```

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `BUILD_STORE` | `json` | `json` \| `memory` \| `redis` |
| `MAX_CONCURRENT_BUILDS` | `2` | global build concurrency cap |

### Enabling Redis (currently a stub)

`RedisBuildStore` is complete against a minimal `RedisLike` interface
(`get`/`set`), but **no Redis is running and no client is wired**, so JSON stays
the default. To activate:

1. `npm install ioredis` (or `redis` — both satisfy `RedisLike`).
2. In `server.ts`: `createBuildStore({ backend: 'redis', redis: new Redis(process.env.REDIS_URL) })`.

> **⚠️ Cluster caveat.** The concurrency guard reads the in-memory mirror, so the
> per-env "already building" lock is **per-node**. True multi-node exclusion needs
> an async `IBuildStore` + a Redis atomic lock (`SET key val NX PX …`). Single-node
> behaviour is correct today; this is the next step for horizontal scale.

---

## 🛠️ Extending

- **New build backend** → implement `IBuilder`, register it in `BuilderRegistry`.
- **New store backend** → extend `InMemoryBuildStore` (reuse `hydrate`/`serialize`),
  add a case to `createBuildStore`.
- **New package manager** → `InstallStepType` in `shared/types/env.ts`,
  translation in `PackageManagerRules`, ordering in `Validator` (see /pipeline).
- **Push to a registry** → add a `RegistryService` (emitting the `BuildProcess`
  `succeeded`/`failed` convention) and call it on build success. *(A prior static stub
  was removed as unwired; see the roadmap item below.)*

## 🗺️ Roadmap

- [ ] Async `IBuildStore` + Redis lock for a **cluster-wide** concurrency guard.
- [ ] `RegistryService`: push successful builds to a remote registry.
- [ ] Skip-rebuild optimization end-to-end reporting (cache hit metrics).
