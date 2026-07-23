// backend/src/services/workspace/localRepo.ts
//
// A workspace's `sourceUrl` is normally an http(s) remote. It may ALSO be a path on the
// server's disk — but only one the SERVER chose: <dataDir>/workspace-sources/<workspaceId>,
// where an uploaded archive is unpacked and `git init`ed. The materialiser then clones from
// it through the ordinary git-url path, so an upload needs no new materialiser, no new
// mount, and no widening of the daemon's bind allow-list.
//
// This is deliberately NOT operator-configurable. An earlier cut had CIDE_LOCAL_REPO_ROOT,
// letting an operator declare a root so a repo already on the host could be cloned. The
// archive upload removes the reason to name a server path at all, and with it a filesystem
// read primitive whose reachable targets included <dataDir>/central-repo.git — which holds
// every tenant's `sbx-*` branch. A path nobody can name is a boundary nobody can argue with.
//
// The containment check stays even though the only writer is now us: `sourceUrl` is
// persisted JSON, so it is data that can be tampered with or restored from an older file,
// and a symlink can appear under the extraction root after the fact.

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from '../../config/paths';

/** Where uploaded archives are unpacked. One directory per workspace, server-named. */
export const WORKSPACE_SOURCES_ROOT = dataPath('workspace-sources');

/** The unpacked-source directory for one workspace. */
export const workspaceSourceDir = (workspaceId: string): string =>
  path.join(WORKSPACE_SOURCES_ROOT, workspaceId);

/** Throws with a user-safe message if `sourceUrl` is not a permitted clone source. */
export async function assertSourceUrlAllowed(sourceUrl: string): Promise<void> {
  if (/^https?:\/\//i.test(sourceUrl)) return;

  // realpath BOTH sides: containment has to be judged on resolved paths, or a symlink
  // under the root pointing out of it walks straight through a lexical check. This also
  // rejects the git transports that are not paths at all — `ext::sh -c ...` executes a
  // command, and it can never resolve to a real file.
  const realRoot = await fs.realpath(WORKSPACE_SOURCES_ROOT).catch(() => null);
  if (!realRoot) throw new Error('sourceUrl must be an http(s) git URL.');

  const realSource = await fs.realpath(sourceUrl).catch(() => {
    throw new Error('sourceUrl must be an http(s) git URL, or an uploaded workspace source.');
  });

  const rel = path.relative(realRoot, realSource);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('sourceUrl must be an http(s) git URL, or an uploaded workspace source.');
  }
}
