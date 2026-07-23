// frontend/src/vfs/BrowserGitPort.ts
//
// Version control with no server: isomorphic-git over the same OPFS tree the editor edits.
// This is what turns the free tier from "edits files locally" into "has a real repository" —
// and, because it can push, what makes **GitHub the durable layer** so nothing has to be
// kept alive between sessions.
//
// Two things are genuinely different here from the backend tier, and both are consequences
// of running in a page rather than dishonesty about the feature:
//
//   1. A CORS PROXY is required for clone/push/pull. GitHub's git endpoints send no CORS
//      headers, so the browser cannot talk to them directly. The proxy is a few lines on
//      the control plane; without one configured, network operations fail with a clear
//      message rather than an opaque fetch error.
//   2. The TOKEN lives in the browser, reversing the server-side-PAT decision in
//      git-integration.md. It is supplied per-call through `onAuth` so it is never stored
//      here, but it is in the page, and that is a real trade the free tier makes.

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { GitStatusEntry, GitLogEntry } from '../api/git';
import { GitAuthor, GitPort, porcelainFromMatrix } from './GitPort';
import { OpfsFs } from './OpfsFs';

const DEFAULT_AUTHOR: GitAuthor = { name: 'Cloud IDE', email: 'noreply@cloud-ide' };

export interface BrowserGitOptions {
  /** Absolute path of the working tree inside the store. */
  dir?: string;
  /** Required for clone/push/pull — GitHub sends no CORS headers of its own. */
  corsProxy?: string;
  /** Credentials, fetched per call so nothing is retained in this object. */
  onAuth?: () => Promise<{ username: string; password: string }>;
}

export class BrowserGitPort implements GitPort {
  private dir: string;

  constructor(private fs: OpfsFs, private options: BrowserGitOptions = {}) {
    this.dir = options.dir ?? '/workspace';
  }

  /** Shared arguments for every call — `fs` and `dir` never vary. */
  private get base() {
    return { fs: this.fs as any, dir: this.dir };
  }

  /** Make an empty working tree into a repository. Safe to call twice. */
  public async init(): Promise<void> {
    await git.init({ ...this.base, defaultBranch: 'main' });
  }

  public async status(): Promise<GitStatusEntry[]> {
    const matrix = await git.statusMatrix(this.base);
    const entries: GitStatusEntry[] = [];
    for (const row of matrix as [string, number, number, number][]) {
      const status = porcelainFromMatrix(row);
      if (status) entries.push({ status, path: row[0] });
    }
    return entries;
  }

  public async branch(): Promise<string> {
    return (await git.currentBranch({ ...this.base, fullname: false })) || 'main';
  }

  public async log(limit = 50): Promise<GitLogEntry[]> {
    const commits = await git.log({ ...this.base, depth: limit });
    return commits.map((entry) => ({
      hash: entry.oid,
      subject: entry.commit.message.split('\n')[0],
      author: entry.commit.author.name,
      // isomorphic-git reports seconds; GitLogEntry.date is an ISO string everywhere else.
      date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    }));
  }

  public async stage(paths?: string[]): Promise<void> {
    // No pathspec: `git.add` takes one filepath, so "everything" means asking status which
    // paths actually differ rather than walking the tree ourselves.
    const targets = paths?.length ? paths : (await this.status()).map((e) => e.path);
    for (const filepath of targets) {
      // A deleted file cannot be `add`ed — it has to be removed from the index instead.
      try {
        await git.add({ ...this.base, filepath });
      } catch {
        await git.remove({ ...this.base, filepath });
      }
    }
  }

  /**
   * `paths` scopes the commit. isomorphic-git has no pathspec on commit, but staging ONLY
   * the selected paths is equivalent here: nothing else stages into this index — there is
   * no terminal running `git add` behind our back — so the index contains exactly what was
   * ticked plus entries that already match HEAD.
   */
  public async commit(message: string, author: GitAuthor = DEFAULT_AUTHOR, paths?: string[]): Promise<void> {
    await this.stage(paths);
    await git.commit({ ...this.base, message, author });
  }

  public async push(): Promise<void> {
    await git.push({ ...this.base, ...this.remoteArgs('push') });
  }

  public async pull(): Promise<void> {
    await git.pull({
      ...this.base,
      ...this.remoteArgs('pull'),
      fastForwardOnly: true,
      author: DEFAULT_AUTHOR, // a merge commit needs an identity even when fast-forwarding
    });
  }

  /** Clone a remote into the working tree — how a browser workspace gets its content. */
  public async clone(url: string, ref?: string): Promise<void> {
    await git.clone({
      ...this.base,
      ...this.remoteArgs('clone'),
      url,
      ref,
      singleBranch: true,
      // Depth-limited: a browser has neither the storage nor the patience for deep history,
      // and isomorphic-git cannot do git's blobless partial clone.
      depth: 50,
    });
  }

  /** http + corsProxy + onAuth, with a legible failure when the proxy is missing. */
  private remoteArgs(operation: string) {
    if (!this.options.corsProxy) {
      throw new Error(
        `Cannot ${operation} from the browser without a CORS proxy: git hosts send no CORS ` +
          `headers, so the request would be blocked by the page's origin policy.`,
      );
    }
    return {
      http,
      corsProxy: this.options.corsProxy,
      onAuth: this.options.onAuth,
    };
  }
}
