// backend/src/config/paths.ts
//
// ONE knob for where all server state lives on disk: the JSON repos, the git central-repo
// and worktrees, terminal sessions, the dev auth secret.
//
// Why it matters: on WSL the default `backend/data` sits on the `/mnt` 9p bridge to the
// Windows filesystem, and every git worktree operation a boot performs crawls across it —
// the biggest single cause of slow sandbox boots. Point CIDE_DATA_DIR at native storage
// (WSL ext4, or a local volume on any Linux) and boots get dramatically faster.
//
// Backend-agnostic on purpose: no WSL-specific code. The default is the historical location
// so existing setups are unchanged; setting the env var relocates the whole data dir. A
// general Linux deployment gets the same win by pointing it at fast local disk.
//
// The daemon (opensandbox/boot.js) reads the SAME CIDE_DATA_DIR to point its bind-mount
// allow-list at the same worktrees — the two MUST agree, so keep them in one .env.
import path from 'node:path';

export const DATA_DIR = process.env.CIDE_DATA_DIR
  ? path.resolve(process.env.CIDE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

/** Join segments under the data root. */
export const dataPath = (...segments: string[]): string => path.join(DATA_DIR, ...segments);
