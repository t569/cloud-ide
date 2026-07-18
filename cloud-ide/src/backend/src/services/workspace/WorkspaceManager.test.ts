// WorkspaceManager's Phase-1b job is the entity lifecycle: mint ids/refs/defaults,
// validate the source, and scope listing to the owner. The repo is a trivial in-memory
// fake here (JsonWorkspaceRepository is tested on its own) so these assert manager logic.
import { WorkspaceManager } from './WorkspaceManager';
import { IWorkspaceRepository } from '../../database/interfaces/IWorkspaceRepository';
import type { WorkspaceRecord } from '../../database/models';

function memRepo(): IWorkspaceRepository {
  const db = new Map<string, WorkspaceRecord>();
  return {
    save: async (w) => { db.set(w.id, w); },
    get: async (id) => db.get(id) ?? null,
    delete: async (id) => { db.delete(id); },
    list: async () => [...db.values()],
    listForOwner: async (owner) => [...db.values()].filter((w) => !w.ownerId || w.ownerId === owner),
  };
}

describe('WorkspaceManager', () => {
  let mgr: WorkspaceManager;
  let materialise: jest.Mock;
  beforeEach(() => {
    materialise = jest.fn(async () => '/host/worktrees/wt-x');
    mgr = new WorkspaceManager(memRepo(), { materialise, dematerialise: jest.fn() });
  });

  it('mints a blank workspace with an id, ref, and safe defaults', async () => {
    const w = await mgr.create({ name: '  My Space  ', ownerId: 'user-1' });
    expect(w.id).toMatch(/^wsp-[0-9a-f-]{36}$/);
    expect(w.ref).toBe(`refs/workspaces/${w.id}`);
    expect(w.name).toBe('My Space');          // trimmed
    expect(w.source).toBe('blank');           // default
    expect(w.persistence).toBe('persistent'); // named workspace won't silently vanish
    expect(w.createdAt).toBe(w.updatedAt);
    expect(await mgr.get(w.id)).toEqual(w);    // persisted
  });

  it('defaults a blank name rather than storing empty', async () => {
    const w = await mgr.create({ name: '   ', ownerId: 'user-1' });
    expect(w.name).toBe('Untitled workspace');
  });

  it('requires a sourceUrl for a git-url workspace', async () => {
    await expect(mgr.create({ name: 'r', ownerId: 'u', source: 'git-url' })).rejects.toThrow(/sourceUrl/);
    const w = await mgr.create({ name: 'r', ownerId: 'u', source: 'git-url', sourceUrl: 'https://github.com/o/r' });
    expect(w.source).toBe('git-url');
    expect(w.sourceUrl).toBe('https://github.com/o/r');
  });

  it('lists only the owner and deletes', async () => {
    const mine = await mgr.create({ name: 'a', ownerId: 'user-1' });
    await mgr.create({ name: 'b', ownerId: 'user-2' });
    expect((await mgr.list('user-1')).map((w) => w.id)).toEqual([mine.id]);
    await mgr.delete(mine.id);
    expect(await mgr.get(mine.id)).toBeNull();
  });

  it('materialise hands the workspace to the materialiser and returns its path', async () => {
    const w = await mgr.create({ name: 'r', ownerId: 'u', source: 'git-url', sourceUrl: 'https://github.com/o/r' });
    const auth = { token: 't', host: 'github.com' };
    const host = await mgr.materialise(w.id, 'wt-x', { fresh: true, auth });
    expect(host).toBe('/host/worktrees/wt-x');
    expect(materialise).toHaveBeenCalledWith({ workspace: w, worktreeId: 'wt-x', fresh: true, auth });
  });

  it('materialise throws on an unknown workspace', async () => {
    await expect(mgr.materialise('wsp-nope', 'wt-x', { fresh: true })).rejects.toThrow(/not found/);
  });
});
