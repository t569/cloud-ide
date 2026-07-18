// The controller's own logic: validate create input, and owner-gate get/delete (404 for
// someone else's id). The manager is a fake; no HTTP — a captured res is enough.
import { WorkspaceController } from './WorkspaceController';
import type { WorkspaceRecord } from '../database/models';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    end() { return this; },
  };
}

const wsp = (over: Partial<WorkspaceRecord>): WorkspaceRecord => ({
  id: 'wsp-1', name: 'w', ownerId: 'user-1', ref: 'refs/workspaces/wsp-1',
  source: 'blank', persistence: 'persistent', createdAt: 0, updatedAt: 0, ...over,
});

function fakeMgr() {
  return {
    list: jest.fn(async (owner: string) => [wsp({ id: 'wsp-a', ownerId: owner })]),
    create: jest.fn(async (input: any) => wsp({ id: 'wsp-new', ...input })),
    get: jest.fn(async (id: string) =>
      id === 'wsp-mine' ? wsp({ id, ownerId: 'user-1' })
      : id === 'wsp-theirs' ? wsp({ id, ownerId: 'user-2' })
      : null),
    delete: jest.fn(async () => undefined),
  } as any;
}

describe('WorkspaceController', () => {
  let mgr: any;
  let ctrl: WorkspaceController;
  beforeEach(() => { mgr = fakeMgr(); ctrl = new WorkspaceController(mgr); });

  it('creates a workspace attributed to the caller', async () => {
    const res = fakeRes();
    await ctrl.create({ userId: 'user-1', body: { name: 'My Space' } } as any, res as any);
    expect(res.statusCode).toBe(201);
    expect(mgr.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Space', ownerId: 'user-1' }));
  });

  it('400s a create with no name', async () => {
    const res = fakeRes();
    await ctrl.create({ userId: 'user-1', body: {} } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(mgr.create).not.toHaveBeenCalled();
  });

  it('400s a git-url source without an http(s) url, and rejects host-folder', async () => {
    const r1 = fakeRes();
    await ctrl.create({ userId: 'u', body: { name: 'r', source: 'git-url', sourceUrl: 'ssh://x' } } as any, r1 as any);
    expect(r1.statusCode).toBe(400);
    const r2 = fakeRes();
    await ctrl.create({ userId: 'u', body: { name: 'r', source: 'host-folder' } } as any, r2 as any);
    expect(r2.statusCode).toBe(400);
    expect(mgr.create).not.toHaveBeenCalled();
  });

  it('owner-gates get/delete — 404 for someone else’s workspace', async () => {
    const mine = fakeRes();
    await ctrl.get({ userId: 'user-1', params: { id: 'wsp-mine' } } as any, mine as any);
    expect(mine.statusCode).toBe(200);

    const theirs = fakeRes();
    await ctrl.get({ userId: 'user-1', params: { id: 'wsp-theirs' } } as any, theirs as any);
    expect(theirs.statusCode).toBe(404);

    const del = fakeRes();
    await ctrl.remove({ userId: 'user-1', params: { id: 'wsp-theirs' } } as any, del as any);
    expect(del.statusCode).toBe(404);
    expect(mgr.delete).not.toHaveBeenCalled();
  });
});
