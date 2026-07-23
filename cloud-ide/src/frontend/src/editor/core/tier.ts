// frontend/src/editor/core/tier.ts
//
// Which tier this editor instance is running on, resolved ONCE and threaded through the
// engines. Everything tier-specific lives here so no component ever branches on it:
//
//   server  → files over /api/fs, real git on the backend worktree, a live sandbox
//   browser → files in OPFS, isomorphic-git, NO sandbox at all
//
// The last part is the honest bit. The browser tier has no container behind it, so there
// is no terminal, no preview, no language server and no filesystem-change stream — nothing
// else is writing to the workspace, so there is nothing to stream. `hasSandbox` says so
// once, and the surfaces that need a sandbox read that flag instead of guessing.

import { FileStore } from '../../vfs/FileStore';
import { HttpFileStore } from '../../vfs/HttpFileStore';
import { OpfsFileStore, type OpfsDirHandle } from '../../vfs/OpfsFileStore';
import { OpfsFs } from '../../vfs/OpfsFs';
import { GitPort } from '../../vfs/GitPort';
import { HttpGitPort } from '../../vfs/HttpGitPort';
import { BrowserGitPort } from '../../vfs/BrowserGitPort';

/** The working tree's path, identical on both tiers so paths mean one thing. */
export const WORKSPACE_DIR = '/workspace';

export interface WorkspaceTier {
  kind: 'server' | 'browser';
  files: FileStore;
  git: GitPort;
  /** False ⇒ no terminal, preview, LSP or live FS events; there is no container. */
  hasSandbox: boolean;
  /** Prepare storage before the VFS hydrates. A no-op on the server tier. */
  ensureReady(): Promise<void>;
}

export interface TierInput {
  sandboxId: string;
  /** 'browser' runs with no server at all. Defaults to 'server'. */
  tier?: 'server' | 'browser';
  /** Namespaces the browser's OPFS subtree; falls back to the sandbox id. */
  workspaceId?: string;
  /** Required for the browser tier to reach a git remote — hosts send no CORS headers. */
  corsProxy?: string;
  onAuth?: () => Promise<{ username: string; password: string }>;
  /** Seam for tests; in a browser this is the real OPFS root. */
  getStorageRoot?: () => Promise<OpfsDirHandle>;
}

export function createTier(input: TierInput): WorkspaceTier {
  if (input.tier !== 'browser') {
    return {
      kind: 'server',
      files: new HttpFileStore(input.sandboxId),
      git: new HttpGitPort(input.sandboxId),
      hasSandbox: true,
      ensureReady: async () => {},
    };
  }

  // ONE namespace for both: the store and git must address the same OPFS subtree, or a
  // commit would record something the editor never wrote.
  const namespace = input.workspaceId ?? input.sandboxId;
  const fs = new OpfsFs(namespace, input.getStorageRoot);
  const git = new BrowserGitPort(fs, {
    dir: WORKSPACE_DIR,
    corsProxy: input.corsProxy,
    onAuth: input.onAuth,
  });

  return {
    kind: 'browser',
    files: new OpfsFileStore(namespace, input.getStorageRoot),
    git,
    hasSandbox: false,
    /**
     * First boot in a given browser has neither the directory nor a repository. Both steps
     * are idempotent, so this runs on every boot rather than needing a "first run" flag —
     * `mkdir` on an existing directory is EEXIST, and `git init` on an existing repo is a
     * documented no-op.
     */
    async ensureReady() {
      await fs.mkdir(WORKSPACE_DIR).catch(() => {}); // EEXIST on every boot but the first
      await git.init();
    },
  };
}
