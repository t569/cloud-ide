// backend/src/controllers/WorkspaceController.ts
//
// HTTP transport for WORKSPACES (workspace-entity.md) — the /workspaces manager API.
// USER-scoped, like the git credential routes: a workspace belongs to a person, so every
// route keys off req.userId and owner-gates by it (404, never 403, so ids stay opaque).
import { Request, Response } from 'express';
import { WorkspaceManager } from '../services/workspace/WorkspaceManager';
import { WorkspaceRecord } from '../database/models';

const SOURCES = new Set(['blank', 'git-url', 'host-folder']);
const PERSISTENCE = new Set(['persistent', 'ephemeral']);

export class WorkspaceController {
  constructor(private workspaces: WorkspaceManager) {}

  /** Load a workspace only if the caller owns it (ownerless records are adoptable). */
  private async owned(req: Request): Promise<WorkspaceRecord | null> {
    const id = typeof req.params.id === 'string' ? req.params.id : undefined;
    if (!id) return null;
    const w = await this.workspaces.get(id);
    if (!w || (w.ownerId && w.ownerId !== req.userId)) return null;
    return w;
  }

  /** GET /api/v1/workspaces — the caller's workspaces (the /workspaces manager list). */
  public list = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.workspaces.list(req.userId ?? ''));
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
      res.status(400).json({ error: 'source must be blank | git-url | host-folder.' });
      return;
    }
    if (source === 'host-folder') {
      // Deferred: host-folder mounts need a mount-security model (the boot allow-list only
      // permits worktrees/caches). Tracked in workspace-entity.md.
      res.status(400).json({ error: 'host-folder workspaces are not supported yet.' });
      return;
    }
    if (source === 'git-url' && (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl))) {
      res.status(400).json({ error: 'git-url workspaces need an http(s) sourceUrl.' });
      return;
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
    res.status(204).end();
  };
}
