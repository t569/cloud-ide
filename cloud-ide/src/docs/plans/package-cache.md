# Persistent Package Caches — plan

Status: **stage 1 implemented** (2026-07-16, feat/display). Stage 2 proposed.

## Problem

The container's writable layer is disposable by design — ⟳ Workspace, recovery, and
egress changes all swap it — but every ecosystem's package cache (`/go/pkg/mod`, pip
wheels, npm tarballs, cargo registry) lived in that layer. Every swap re-downloaded the
world (`go run .` after a restart re-fetched raylib every time). Baking packages into
images doesn't fix it: the env baked `raylib@v0.56.0-dev`, projects pin other versions,
and the baked cache never matches.

## Stage 1 — per-user host-backed cache volume (SHIPPED)

One `VolumeMount` per sandbox: host `data/caches/<userId>` → container `/cide-cache`,
plus boot env vars pointing every ecosystem's cache into it (`cacheVolumes.ts`:
GOMODCACHE, GOCACHE, PIP_CACHE_DIR, npm_config_cache, YARN_CACHE_FOLDER, CARGO_HOME,
GRADLE_USER_HOME — env-declared values win). Appended in `provision()` AFTER user-volume
normalization, since `/cide-cache` is a system path, not a `/workspace/mounts/*` mount.

Properties: first download ever is the last — across container swaps, workspace
restarts, and even workspace deletion (destroy removes the worktree, never the cache).
Per-USER isolation: no cross-tenant cache-poisoning question to answer.

Deliberate ceilings (`ponytail:` comments in code):
- No cache GC — add a size-capped sweep when disk pressure is real.
- Host dir is 0777 — the container's non-root uid is unpredictable; same trust stance
  as the worktree mount. Per-user uid mapping if this goes multi-tenant/multi-node.

## Stage 2 — package proxy sidecar (PROPOSED, the "cutting-edge" one)

A host-side proxy trio — Athens (GOPROXY), verdaccio (npm), devpi (pip) — that every
sandbox is pointed at via env. Why this is smart rather than exotic:

- **Sharing becomes safe by protocol**: Go's sumdb, npm integrity hashes, and pip
  lockfile hashes verify content cryptographically — a shared cache's poisoning risk
  is answered by the package managers themselves, not by us.
- **Egress synergy**: sandboxes fetch from ONE internal endpoint; the deny-default
  allow-list can eventually drop the public registry domains entirely.
- **Fleet-wide dedup + LAN-speed installs** for every user at once.

Cost: three more host services to run and monitor. Build it when there are enough
users/sandboxes that per-user caches measurably duplicate storage — not before.

## Explicitly rejected

Hand-rolled content-addressed/overlay dedup of caches: Go's module cache and the
GOPROXY protocol already ARE content-addressed stores; reimplementing them under
docker is a bug farm with a hit rate (same reasoning as "git IS our Merkle tree").
