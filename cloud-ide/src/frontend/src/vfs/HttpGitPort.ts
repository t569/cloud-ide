// frontend/src/vfs/HttpGitPort.ts
//
// The GitPort backed by real git on the backend worktree — the existing /api/git calls,
// moved behind the port with no change in behaviour. This is the tier where the PAT stays
// server-side and clone/push need no CORS proxy.
import {
  getGitStatus, getGitBranch, getGitLog, getGitDiff,
  gitStage, gitCommit, gitPush, gitPull,
  type GitStatusEntry, type GitLogEntry,
} from '../api/git';
import { GitAuthor, GitPort } from './GitPort';

export class HttpGitPort implements GitPort {
  constructor(private sandboxId: string) {}

  public async status(): Promise<GitStatusEntry[]> {
    return (await getGitStatus(this.sandboxId)).entries;
  }

  public async branch(): Promise<string> {
    return (await getGitBranch(this.sandboxId)).branch;
  }

  public async log(limit = 50): Promise<GitLogEntry[]> {
    return (await getGitLog(this.sandboxId, limit)).commits;
  }

  public async diff(path?: string): Promise<string> {
    return (await getGitDiff(this.sandboxId, path)).diff;
  }

  public stage(paths?: string[]): Promise<void> {
    return gitStage(this.sandboxId, paths);
  }

  public commit(message: string, author?: GitAuthor, paths?: string[]): Promise<void> {
    return gitCommit(this.sandboxId, message, author, paths);
  }

  public push(): Promise<void> {
    return gitPush(this.sandboxId);
  }

  public pull(): Promise<void> {
    return gitPull(this.sandboxId);
  }
}
