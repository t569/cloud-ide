// backend/src/services/git/GitHubBrowse.ts
//
// Read-only GitHub browse — the "peek at a repo without cloning" mode (git-integration.md).
// The salvaged core of the old frontend github.ts, moved SERVER-SIDE and rebuilt on native
// fetch (Node 18+ global fetch) — no octokit, which was a heavy dep for two GET calls.
//
// The caller's stored PAT (when present) authenticates the request, so private repos work
// and the rate limit is the authenticated one. Unauthenticated = public repos only.
//
// SSRF is bounded: the host is fixed (api.github.com) and owner/repo/branch are
// URL-encoded per segment, so a caller can't redirect the request off GitHub or inject a
// query. The controller additionally rejects owner/repo that aren't plain slugs.

export interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  /** Byte size for blobs; absent for trees. */
  size?: number;
}

export interface GitHubTree {
  sha: string;
  /** GitHub caps a recursive tree; true means entries are incomplete (very large repo). */
  truncated: boolean;
  entries: GitHubTreeEntry[];
}

/** Carries the upstream HTTP status so the controller can mirror it (404/401/403…). */
export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubBrowse {
  constructor(private readonly api = 'https://api.github.com') {}

  private async gh(pathname: string, token?: string): Promise<any> {
    const res = await fetch(`${this.api}${pathname}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cloud-ide',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GitHubError(res.status, `GitHub ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  /** Recursive tree of a repo. `branch` defaults to the repo's default branch. */
  public async getTree(owner: string, repo: string, opts: { branch?: string; token?: string } = {}): Promise<GitHubTree> {
    let branch = opts.branch;
    if (!branch) {
      const meta = await this.gh(`/repos/${enc(owner)}/${enc(repo)}`, opts.token);
      branch = meta.default_branch;
    }
    const t = await this.gh(`/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(branch!)}?recursive=1`, opts.token);
    return {
      sha: t.sha,
      truncated: !!t.truncated,
      entries: (t.tree ?? [])
        .filter((e: any) => e.type === 'blob' || e.type === 'tree')
        .map((e: any) => ({ path: e.path, type: e.type, sha: e.sha, size: e.size })),
    };
  }

  /** UTF-8 content of a single file. Throws if the path is a directory. */
  public async getContent(owner: string, repo: string, filePath: string, opts: { ref?: string; token?: string } = {}): Promise<string> {
    const q = opts.ref ? `?ref=${enc(opts.ref)}` : '';
    const data = await this.gh(`/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(filePath)}${q}`, opts.token);
    if (Array.isArray(data)) throw new GitHubError(400, 'Path is a directory, not a file.');
    if (data.encoding !== 'base64') throw new GitHubError(422, `Unexpected content encoding: ${data.encoding}`);
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
}

/** Encode one path segment (owner/repo/branch): keeps it a single segment, no injection. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** Encode a file path segment-by-segment so '/' survives but '?', '..', spaces don't. */
function encPath(filePath: string): string {
  return filePath
    .split('/')
    .filter((s) => s && s !== '..' && s !== '.')
    .map(encodeURIComponent)
    .join('/');
}
