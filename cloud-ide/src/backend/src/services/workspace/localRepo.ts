// backend/src/services/workspace/localRepo.ts
//
// A workspace's `sourceUrl` is normally an http(s) remote. It may ALSO be a path to a git
// repo already on the server's disk — the supported answer to "I want to work on a local
// folder" now that host-folder mounts are dropped (git-integration.md). git clones happily
// from a filesystem path, and the clone lands in the allow-listed worktrees root, so the
// whole git surface keeps working; nothing about the mount boundary moves.
//
// But it IS a read primitive over the server's filesystem, and the reachable targets are
// not hypothetical: `<dataDir>/central-repo.git` holds every tenant's `sbx-*` branch, and
// `<dataDir>/worktrees/<id>` is someone's checkout. So it is OFF unless an operator opts
// in by declaring a root:
//
//   CIDE_LOCAL_REPO_ROOT=/home/me/projects
//
// Unset (the production default) → only http(s) is accepted, exactly as before.
//
// ponytail: one root, not a per-user policy table — this exists for a single-node dev host.
// If it ever needs to be per-tenant, that is a mount-security model and belongs with one.

import fs from 'node:fs/promises';
import path from 'node:path';

/** Throws with a user-safe message if `sourceUrl` is not a permitted clone source. */
export async function assertSourceUrlAllowed(sourceUrl: string): Promise<void> {
  if (/^https?:\/\//i.test(sourceUrl)) return;

  const root = process.env.CIDE_LOCAL_REPO_ROOT?.trim();
  if (!root) throw new Error('sourceUrl must be an http(s) git URL.');

  // realpath BOTH sides: containment has to be judged on the resolved paths, or a symlink
  // inside the root pointing out of it walks straight through the check. This is also why
  // the materialiser re-checks instead of trusting the create-time verdict — the link can
  // be re-pointed in between.
  const realRoot = await fs.realpath(root).catch(() => {
    throw new Error('CIDE_LOCAL_REPO_ROOT does not exist.');
  });
  const realSource = await fs.realpath(sourceUrl).catch(() => {
    throw new Error('Local repo path does not exist.');
  });

  const rel = path.relative(realRoot, realSource);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Local repo path is outside CIDE_LOCAL_REPO_ROOT.');
  }
}
