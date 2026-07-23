// backend/src/controllers/WorkspaceController.ts
//
// HTTP transport for WORKSPACES (workspace-entity.md) — the /workspaces manager API.
// USER-scoped, like the git credential routes: a workspace belongs to a person, so every
// route keys off req.userId and owner-gates by it (404, never 403, so ids stay opaque).
import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import { WorkspaceManager } from '../services/workspace/WorkspaceManager';
import { GitCredentialStore, workspaceCredentialKey as wsKey } from '../services/git/GitCredentialStore';
import { WorkspaceRecord } from '../database/models';
import { assertSourceUrlAllowed, workspaceSourceDir } from '../services/workspace/localRepo';
import { extractZip } from '../services/workspace/unzip';
import { WorktreeEngine } from '../services/storage/WorktreeEngine';

const SOURCES = new Set(['blank', 'git-url']);
const PERSISTENCE = new Set(['persistent', 'ephemeral']);
// Workspace tokens share the user credential store under a `ws:` namespace (wsKey) — same
// AES-256-GCM + atomic writes, no second file. ponytail: assumes no userId literally equals
// `ws:<workspaceId>` (ids are opaque) — split into a second store instance if that breaks.

export class WorkspaceController {
  constructor(
    private workspaces: WorkspaceManager,
    private credentials: GitCredentialStore,
    /** Only to `git init` an unpacked upload — every git invocation goes through it. */
    private worktrees: WorktreeEngine,
  ) {}

  /** Load a workspace only if the caller owns it (ownerless records are adoptable). */
  private async owned(req: Request): Promise<WorkspaceRecord | null> {
    const id = typeof req.params.id === 'string' ? req.params.id : undefined;
    if (!id) return null;
    const w = await this.workspaces.get(id);
    if (!w || (w.ownerId && w.ownerId !== req.userId)) return null;
    return w;
  }

  /** GET /api/v1/workspaces — the caller's workspaces, each tagged with its token status. */
  public list = async (req: Request, res: Response): Promise<void> => {
    const list = await this.workspaces.list(req.userId ?? '');
    const hosts = await this.credentials.hosts(); // one read, no decryption
    res.json(list.map((w) => {
      const host = hosts[wsKey(w.id)] ?? null;
      return { ...w, hasCredential: host !== null, credentialHost: host };
    }));
  };

  /** POST /api/v1/workspaces — create a workspace. */
  public create = async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'No identity.' });
      return;
    }
    const { name, source, sourceUrl, persistence } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }
    if (source !== undefined && !SOURCES.has(source)) {
      res.status(400).json({ error: 'source must be blank | git-url.' });
      return;
    }
    if (source === 'git-url') {
      if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
        res.status(400).json({ error: 'git-url workspaces need a sourceUrl.' });
        return;
      }
      // http(s), or a local repo path when the operator has declared a root (localRepo.ts).
      // Checked again at materialise time — this call is for a clean error, not the gate.
      try {
        await assertSourceUrlAllowed(sourceUrl.trim());
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    if (persistence !== undefined && !PERSISTENCE.has(persistence)) {
      res.status(400).json({ error: 'persistence must be persistent | ephemeral.' });
      return;
    }
    try {
      const workspace = await this.workspaces.create({ name, ownerId: req.userId, source, sourceUrl, persistence });
      res.status(201).json(workspace);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  /** GET /api/v1/workspaces/:id — one workspace the caller owns. */
  public get = async (req: Request, res: Response): Promise<void> => {
    const w = await this.owned(req);
    if (!w) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(w);
  };

  /** DELETE /api/v1/workspaces/:id — forget a workspace the caller owns. */
  public remove = async (req: Request, res: Response): Promise<void> => {
    const w = await this.owned(req);
    if (!w) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await this.workspaces.delete(w.id);
    await this.credentials.clear(wsKey(w.id)); // don't strand this workspace's token
    res.status(204).end();
  };

  /**
   * POST /api/v1/workspaces/:id/archive — upload a .zip of a project folder, which becomes
   * this workspace's source.
   *
   * RAW bytes, not multipart: the browser sends the File object straight as the body, so
   * there is no multipart parser to add and nothing to reassemble. The route mounts its own
   * express.raw with the size cap (WorkspaceRoutes.ts).
   *
   * The archive is unpacked into a directory the SERVER names and `git init`ed, so the
   * workspace materialises by cloning it exactly like any git-url — no new materialiser,
   * no new mount, nothing added to the daemon's bind allow-list.
   */
  public uploadArchive = async (req: Request, res: Response): Promise<void> => {
    const w = await this.owned(req);
    if (!w) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Send the archive as the raw request body.' });
      return;
    }

    const dir = workspaceSourceDir(w.id);
    try {
      // Replace rather than merge: a re-upload is a NEW source, and files left from the
      // previous one would silently join the workspace without appearing in the archive.
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      const files = await extractZip(req.body, dir);
      await this.worktrees.initSourceRepo(dir);
      res.json({ ...(await this.workspaces.setArchiveSource(w.id, dir)), files });
    } catch (err: any) {
      // A rejected archive leaves nothing behind — the record still points at whatever
      // source it had before, which is why setArchiveSource runs last.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      res.status(400).json({ error: (err.stderr || err.message || 'Could not read the archive.').toString().trim() });
    }
  };

  /** PUT /api/v1/workspaces/:id/credential { token, host? } — repo-specific PAT (encrypted). */
  public setCredential = async (req: Request, res: Response): Promise<void> => {
    const w = await this.owned(req);
    if (!w) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const token = req.body?.token;
    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'token is required.' });
      return;
    }
    const host = typeof req.body?.host === 'string' && req.body.host.trim() ? req.body.host.trim() : 'github.com';
    await this.credentials.set(wsKey(w.id), { host, token: token.trim() });
    res.status(204).end();
  };

  /** DELETE /api/v1/workspaces/:id/credential — forget this workspace's PAT (falls back to account). */
  public clearCredential = async (req: Request, res: Response): Promise<void> => {
    const w = await this.owned(req);
    if (!w) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await this.credentials.clear(wsKey(w.id));
    res.status(204).end();
  };
}
