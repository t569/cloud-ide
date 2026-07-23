// frontend/src/vfs/GitPort.ts
//
// Version control, independent of where the repository lives:
//
//   HttpGitPort    → real git on the backend worktree      (server tiers)
//   BrowserGitPort → isomorphic-git on OPFS, no server     (the free tier)
//
// The shapes match `api/git.ts` exactly, so the Source Control pane and the commit-history
// rail work against either without knowing which they have.
//
// `diff` is OPTIONAL. isomorphic-git ships no unified-diff formatter, and inventing one
// would mean shipping a diff algorithm to make a UI panel look complete. The pane already
// copes with a file it cannot show a diff for, so the honest thing is to let the type say
// so — same reasoning as FileStore.readExternal.

import { GitStatusEntry, GitLogEntry } from '../api/git';

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitPort {
  /** Porcelain-style two-char codes, so one renderer serves both tiers. */
  status(): Promise<GitStatusEntry[]>;
  branch(): Promise<string>;
  log(limit?: number): Promise<GitLogEntry[]>;
  /** Stage paths, or everything when omitted. */
  stage(paths?: string[]): Promise<void>;
  /** `paths` scopes the commit to exactly those files. */
  commit(message: string, author?: GitAuthor, paths?: string[]): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  /** Unified diff. Absent where the implementation cannot produce one. */
  diff?(path?: string): Promise<string>;
}

/**
 * isomorphic-git's status matrix → the porcelain codes the UI already renders.
 *
 * A row is `[path, HEAD, WORKDIR, STAGE]` where HEAD is 0 absent / 1 present, WORKDIR is
 * 0 absent / 1 same as HEAD / 2 different, and STAGE is 0 absent / 1 same as HEAD /
 * 2 different from HEAD / 3 different from WORKDIR. Unchanged rows are dropped, matching
 * `git status --porcelain`, which lists only what differs.
 */
export function porcelainFromMatrix(row: [string, number, number, number]): string | null {
  const [, head, workdir, stage] = row;
  if (head === 1 && workdir === 1 && stage === 1) return null; // clean
  if (head === 0 && stage === 0) return '??';                  // untracked
  if (head === 0) return 'A ';                                 // newly staged
  if (workdir === 0) return stage === 0 ? 'D ' : ' D';         // deleted, staged or not
  return stage === 2 || stage === 3 ? 'M ' : ' M';             // modified, staged or not
}
