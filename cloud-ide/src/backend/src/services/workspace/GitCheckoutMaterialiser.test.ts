// The materialiser's one decision: clone a fresh git-url workspace into its checkout,
// but reuse (never re-clone) on recovery or for a blank workspace. WorktreeEngine is a
// mock — its git is tested elsewhere; here we assert which call is chosen.
import { GitCheckoutMaterialiser } from './GitCheckoutMaterialiser';
import type { WorkspaceRecord } from '../../database/models';

const wsp = (over: Partial<WorkspaceRecord>): WorkspaceRecord => ({
  id: 'wsp-1', name: 'w', ownerId: 'u', ref: 'refs/workspaces/wsp-1',
  source: 'blank', persistence: 'persistent', createdAt: 0, updatedAt: 0, ...over,
});

function engine() {
  return {
    cloneInto: jest.fn(async () => '/host/wt/cloned'),
    createWorktree: jest.fn(async () => '/host/wt/blank'),
    removeWorktree: jest.fn(async () => undefined),
  } as any;
}

describe('GitCheckoutMaterialiser', () => {
  it('clones a fresh git-url workspace into its checkout', async () => {
    const e = engine();
    const m = new GitCheckoutMaterialiser(e);
    const auth = { token: 't', host: 'github.com' };
    const host = await m.materialise({
      workspace: wsp({ source: 'git-url', sourceUrl: 'https://github.com/o/r' }),
      worktreeId: 'wt-1', fresh: true, auth,
    });
    expect(host).toBe('/host/wt/cloned');
    expect(e.cloneInto).toHaveBeenCalledWith('wt-1', 'https://github.com/o/r', auth);
    expect(e.createWorktree).not.toHaveBeenCalled();
  });

  it('gives a blank workspace an empty checkout', async () => {
    const e = engine();
    await new GitCheckoutMaterialiser(e).materialise({ workspace: wsp({}), worktreeId: 'wt-2', fresh: true });
    expect(e.createWorktree).toHaveBeenCalledWith('wt-2');
    expect(e.cloneInto).not.toHaveBeenCalled();
  });

  it('reuses the checkout on recovery — a git-url workspace is NOT re-cloned', async () => {
    const e = engine();
    await new GitCheckoutMaterialiser(e).materialise({
      workspace: wsp({ source: 'git-url', sourceUrl: 'https://github.com/o/r' }),
      worktreeId: 'wt-3', fresh: false,
    });
    expect(e.createWorktree).toHaveBeenCalledWith('wt-3'); // idempotent reuse
    expect(e.cloneInto).not.toHaveBeenCalled();
  });

  it('dematerialise removes the checkout', async () => {
    const e = engine();
    await new GitCheckoutMaterialiser(e).dematerialise('wt-4');
    expect(e.removeWorktree).toHaveBeenCalledWith('wt-4');
  });
});
