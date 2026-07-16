// Persistent per-user package caches (docs/plans/package-cache.md).
//
// The container's writable layer is DISPOSABLE — restart/recovery/egress changes
// all swap it — but Go modules, pip wheels, and npm tarballs used to live there,
// so every swap re-downloaded the world. This mounts ONE host-backed volume per
// user at /cide-cache and points every ecosystem's cache env var into it: the
// first download ever is the last, across container swaps and even workspace
// deletion (destroy removes the worktree, never the cache).
//
// Per-USER, not shared: a shared cache raises cross-tenant poisoning questions;
// per-user needs no answer. (The shared, protocol-verified answer is a package
// proxy sidecar — GOPROXY + sumdb et al — planned as stage 2.)
// ponytail: no cache GC — add a size-capped sweep when disk pressure is real.
import fs from 'node:fs/promises';
import type { VolumeMount } from '@cloud-ide/shared/types/sandbox';
import { dataPath } from '../../config/paths';

export const CACHE_MOUNT_PATH = '/cide-cache';

/** Every ecosystem cache we relocate. Harmless when the tool isn't installed —
 *  an env var pointing nowhere costs nothing. Values the env/user set win. */
export const CACHE_ENV: Record<string, string> = {
  GOMODCACHE: `${CACHE_MOUNT_PATH}/go/mod`,
  GOCACHE: `${CACHE_MOUNT_PATH}/go/build`,
  PIP_CACHE_DIR: `${CACHE_MOUNT_PATH}/pip`,
  npm_config_cache: `${CACHE_MOUNT_PATH}/npm`,
  YARN_CACHE_FOLDER: `${CACHE_MOUNT_PATH}/yarn`,
  CARGO_HOME: `${CACHE_MOUNT_PATH}/cargo`,
  GRADLE_USER_HOME: `${CACHE_MOUNT_PATH}/gradle`,
};

/** The host-backed cache volume for `ownerId`, creating its directory. */
export async function cacheVolumeFor(ownerId: string): Promise<VolumeMount> {
  // 'anon' groups ownerless raw-verb sandboxes rather than minting junk dirs.
  const hostPath = dataPath('caches', ownerId || 'anon');
  // 0777: the container writes as its own non-root user, whose uid the host
  // can't predict. Same trust stance as the worktree mount.
  // ponytail: per-user uid mapping if this ever runs multi-node/multi-tenant.
  await fs.mkdir(hostPath, { recursive: true, mode: 0o777 });
  return {
    name: 'cide-pkg-cache',
    kind: 'user',
    hostPath,
    mountPath: CACHE_MOUNT_PATH,
    readOnly: false,
  };
}
