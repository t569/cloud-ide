// backend/src/controllers/GitController.ts
//
// HTTP transport for the version-control feature (docs/plans/git-integration.md).
//
// Two audiences, two guards:
//   - Sandbox-scoped git ops (status/log/diff/stage/commit/push/pull) mount under the
//     SandboxRoutes `/:sandboxId` ownership guard — the caller must own the sandbox.
//   - Credential ops are USER-scoped (a PAT belongs to a person, not a sandbox); they key
//     off req.userId and need no sandbox ownership.
//
// A sandbox's worktree dir is named by its worktreeId, not its sandboxId — every op
// resolves that from the record before touching the engine.

import { Request, Response } from 'express';
import { ISandboxRepository } from '../database/interfaces';
import { WorktreeEngine, GitAuth } from '../services/storage/WorktreeEngine';
import { GitCredentialStore, workspaceCredentialKey } from '../services/git/GitCredentialStore';
import { GitHubBrowse, GitHubError } from '../services/git/GitHubBrowse';

/** GitHub owner/repo slug — no slashes or query chars, so it can't escape the API URL. */
const SLUG = /^[A-Za-z0-9_.-]{1,100}$/;

export class GitController {
  constructor(
    private sandboxRepo: ISandboxRepository,
    private worktrees: WorktreeEngine,
    private credentials: GitCredentialStore,
    private github: GitHubBrowse,
  ) {}

  /** sandboxId → worktree dir name, or null if the sandbox has no worktree yet. */
  private async worktreeId(sandboxId: string): Promise<string | null> {
    const record = await this.sandboxRepo.get(sandboxId);
    return record?.worktreeId ?? null;
  }

  /** The caller's stored credential as GitAuth, or undefined (public-repo path). */
  private async authFor(userId: string | undefined): Promise<GitAuth | undefined> {
    if (!userId) return undefined;
    const cred = await this.credentials.get(userId);
    return cred ? { token: cred.token, host: cred.host } : undefined;
  }

  /**
   * Auth for a SANDBOX's push/pull, with the same precedence a launch clone uses
   * (SessionController.authFor): if the sandbox was injected from a workspace that has
   * its own token, that token wins; otherwise fall back to the caller's account token.
   * Without this, a repo cloned with a workspace token could still fail to push.
   */
  private async authForSandbox(sandboxId: string | undefined, userId: string | undefined): Promise<GitAuth | undefined> {
    const record = sandboxId ? await this.sandboxRepo.get(sandboxId) : null;
    if (record?.workspaceId) {
      const ws = await this.credentials.get(workspaceCredentialKey(record.workspaceId));
      if (ws) return { token: ws.token, host: ws.host };
    }
    return this.authFor(userId);
  }

  /**
   * Resolve the worktree and run `fn`, mapping the two failure modes callers care
   * about: no worktree → 409, git failure → 400 with git's stderr (e.g. "nothing to
   * commit", a rejected push). Keeps every handler to its one interesting line.
   */
  private async withWorktree(
    req: Request,
    res: Response,
    fn: (worktreeId: string) => Promise<unknown>,
  ): Promise<void> {
    const sandboxId = typeof req.params.sandboxId === 'string' ? req.params.sandboxId : undefined;
    const wt = sandboxId ? await this.worktreeId(sandboxId) : null;
    if (!wt) {
      res.status(409).json({ error: 'Sandbox has no worktree.' });
      return;
    }
    try {
      const result = await fn(wt);
      if (result === undefined) res.status(204).end();
      else res.json(result);
    } catch (err: any) {
      // git exit-nonzero rejects with stderr attached; surface it so the UI can show
      // the real reason ("nothing to commit", "Updates were rejected", auth failure).
      res.status(400).json({ error: (err.stderr || err.message || 'git operation failed').toString().trim() });
    }
  }

  // ── Sandbox-scoped git ops (owner-gated by SandboxRoutes) ──────────────────

  public status = (req: Request, res: Response) =>
    this.withWorktree(req, res, (wt) => this.worktrees.status(wt).then((entries) => ({ entries })));

  public log = (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    return this.withWorktree(req, res, (wt) => this.worktrees.log(wt, limit).then((commits) => ({ commits })));
  };

  public branch = (req: Request, res: Response) =>
    this.withWorktree(req, res, (wt) => this.worktrees.currentBranch(wt).then((branch) => ({ branch })));

  public diff = (req: Request, res: Response) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : undefined;
    return this.withWorktree(req, res, (wt) => this.worktrees.diff(wt, filePath).then((diff) => ({ diff })));
  };

  public stage = (req: Request, res: Response) => {
    const paths = req.body?.paths;
    if (paths !== undefined && (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string'))) {
      res.status(400).json({ error: 'paths must be an array of strings.' });
      return Promise.resolve();
    }
    return this.withWorktree(req, res, (wt) => this.worktrees.stage(wt, paths));
  };

  public commit = (req: Request, res: Response) => {
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return Promise.resolve();
    }
    const author = req.body?.author;
    if (author !== undefined && (typeof author?.name !== 'string' || typeof author?.email !== 'string')) {
      res.status(400).json({ error: 'author must be { name, email }.' });
      return Promise.resolve();
    }
    return this.withWorktree(req, res, (wt) => this.worktrees.commit(wt, message, author));
  };

  public push = (req: Request, res: Response) => {
    const sandboxId = typeof req.params.sandboxId === 'string' ? req.params.sandboxId : undefined;
    return this.withWorktree(req, res, async (wt) => this.worktrees.push(wt, await this.authForSandbox(sandboxId, req.userId)));
  };

  public pull = (req: Request, res: Response) => {
    const sandboxId = typeof req.params.sandboxId === 'string' ? req.params.sandboxId : undefined;
    return this.withWorktree(req, res, async (wt) => this.worktrees.pull(wt, await this.authForSandbox(sandboxId, req.userId)));
  };

  // ── User-scoped credential ops (keyed by req.userId) ───────────────────────

  /** GET — connection state for the UI. NEVER returns the token itself. */
  public getCredential = async (req: Request, res: Response): Promise<void> => {
    const cred = req.userId ? await this.credentials.get(req.userId) : null;
    res.json({ configured: !!cred, host: cred?.host ?? null });
  };

  /** PUT { token, host? } — store/replace the caller's PAT (encrypted at rest). */
  public setCredential = async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'No identity.' });
      return;
    }
    const token = req.body?.token;
    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'token is required.' });
      return;
    }
    const host = typeof req.body?.host === 'string' && req.body.host.trim() ? req.body.host.trim() : 'github.com';
    await this.credentials.set(req.userId, { host, token: token.trim() });
    res.status(204).end();
  };

  /** DELETE — forget the caller's PAT. */
  public clearCredential = async (req: Request, res: Response): Promise<void> => {
    if (req.userId) await this.credentials.clear(req.userId);
    res.status(204).end();
  };

  // ── Read-only GitHub browse (no clone needed) ──────────────────────────────
  // User-scoped: uses the caller's stored PAT so private repos + the authenticated
  // rate limit work. A GitHubError mirrors GitHub's own status (404 stays 404).

  private async browseToken(userId: string | undefined): Promise<string | undefined> {
    return (await this.authFor(userId))?.token;
  }

  private mapGitHubError(res: Response, err: any): void {
    const status = err instanceof GitHubError ? err.status : 502;
    res.status(status).json({ error: (err.message || 'GitHub request failed').toString() });
  }

  /** GET /api/v1/git/browse/:owner/:repo/tree?branch= — recursive repo tree. */
  public browseTree = async (req: Request, res: Response): Promise<void> => {
    const { owner, repo } = req.params;
    if (typeof owner !== 'string' || typeof repo !== 'string' || !SLUG.test(owner) || !SLUG.test(repo)) {
      res.status(400).json({ error: 'Invalid owner or repo.' });
      return;
    }
    const branch = typeof req.query.branch === 'string' ? req.query.branch : undefined;
    try {
      res.json(await this.github.getTree(owner, repo, { branch, token: await this.browseToken(req.userId) }));
    } catch (err) {
      this.mapGitHubError(res, err);
    }
  };

  /** GET /api/v1/git/browse/:owner/:repo/content?path=&ref= — one file's UTF-8 content. */
  public browseContent = async (req: Request, res: Response): Promise<void> => {
    const { owner, repo } = req.params;
    const filePath = req.query.path;
    if (typeof owner !== 'string' || typeof repo !== 'string' || !SLUG.test(owner) || !SLUG.test(repo)
        || typeof filePath !== 'string' || !filePath) {
      res.status(400).json({ error: 'owner, repo and path are required.' });
      return;
    }
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
    try {
      const content = await this.github.getContent(owner, repo, filePath, { ref, token: await this.browseToken(req.userId) });
      res.json({ content });
    } catch (err) {
      this.mapGitHubError(res, err);
    }
  };
}
