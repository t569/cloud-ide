// The controller's own logic is glue: resolve worktreeId, validate input, map git
// failures to status codes, and thread the stored PAT into network ops. Those branches
// are what break silently, so they get the test — the engine and store are covered
// elsewhere, here they're fakes. No HTTP: a captured res is enough.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitController } from './GitController';
import { GitCredentialStore, workspaceCredentialKey } from '../services/git/GitCredentialStore';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    end() { return this; },
  };
}

const repo = {
  get: async (id: string) =>
    id === 'has-wt' ? { sandboxId: id, worktreeId: 'wt-1' }
    : id === 'has-ws' ? { sandboxId: id, worktreeId: 'wt-2', workspaceId: 'wsp-9' }
    : id === 'no-wt' ? { sandboxId: id }
    : null,
} as any;

describe('GitController', () => {
  let dir: string;
  let store: GitCredentialStore;
  let engine: any;
  let github: any;
  let ctrl: GitController;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitctrl-'));
    store = new GitCredentialStore(crypto.randomBytes(32), dir);
    engine = {
      status: jest.fn(async () => [{ status: ' M', path: 'a.txt' }]),
      commit: jest.fn(async () => undefined),
      push: jest.fn(async () => undefined),
    };
    github = {
      getTree: jest.fn(async () => ({ sha: 'x', truncated: false, entries: [] })),
      getContent: jest.fn(async () => 'file body'),
    };
    ctrl = new GitController(repo, engine, store, github);
  });

  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('409s when the sandbox has no worktree', async () => {
    const res = fakeRes();
    await ctrl.status({ params: { sandboxId: 'no-wt' } } as any, res as any);
    expect(res.statusCode).toBe(409);
  });

  it('resolves worktreeId (not sandboxId) and returns status', async () => {
    const res = fakeRes();
    await ctrl.status({ params: { sandboxId: 'has-wt' } } as any, res as any);
    expect(engine.status).toHaveBeenCalledWith('wt-1'); // worktreeId from the record
    expect(res.body).toEqual({ entries: [{ status: ' M', path: 'a.txt' }] });
  });

  it('400s a commit with no message, without touching git', async () => {
    const res = fakeRes();
    await ctrl.commit({ params: { sandboxId: 'has-wt' }, body: {} } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(engine.commit).not.toHaveBeenCalled();
  });

  it('maps a git failure to 400 with its stderr', async () => {
    engine.commit.mockRejectedValueOnce({ stderr: 'nothing to commit, working tree clean' });
    const res = fakeRes();
    await ctrl.commit({ params: { sandboxId: 'has-wt' }, body: { message: 'x' } } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('nothing to commit');
  });

  it('threads the stored PAT into push; getCredential never leaks the token', async () => {
    const setRes = fakeRes();
    await ctrl.setCredential({ userId: 'u1', body: { token: 'ghp_secret', host: 'github.com' } } as any, setRes as any);
    expect(setRes.statusCode).toBe(204);

    // GET returns state only, never the token.
    const getRes = fakeRes();
    await ctrl.getCredential({ userId: 'u1' } as any, getRes as any);
    expect(getRes.body).toEqual({ configured: true, host: 'github.com' });
    expect(JSON.stringify(getRes.body)).not.toContain('ghp_secret');

    // push pulls that credential and hands it to the engine as GitAuth.
    await ctrl.push({ params: { sandboxId: 'has-wt' }, userId: 'u1' } as any, fakeRes() as any);
    expect(engine.push).toHaveBeenCalledWith('wt-1', { token: 'ghp_secret', host: 'github.com' });
  });

  it('pushes without auth when the user has no stored PAT (public-repo path)', async () => {
    await ctrl.push({ params: { sandboxId: 'has-wt' }, userId: 'nobody' } as any, fakeRes() as any);
    expect(engine.push).toHaveBeenCalledWith('wt-1', undefined);
  });

  it('push prefers the sandbox WORKSPACE token over the account token', async () => {
    // Account token for the user…
    await ctrl.setCredential({ userId: 'u1', body: { token: 'ghp_account', host: 'github.com' } } as any, fakeRes() as any);
    // …and a token on the workspace this sandbox was injected from.
    await store.set(workspaceCredentialKey('wsp-9'), { token: 'ghp_workspace', host: 'github.com' });

    await ctrl.push({ params: { sandboxId: 'has-ws' }, userId: 'u1' } as any, fakeRes() as any);
    expect(engine.push).toHaveBeenCalledWith('wt-2', { token: 'ghp_workspace', host: 'github.com' });
  });

  it('push falls back to the account token when the workspace has none', async () => {
    await ctrl.setCredential({ userId: 'u1', body: { token: 'ghp_account', host: 'github.com' } } as any, fakeRes() as any);
    await ctrl.push({ params: { sandboxId: 'has-ws' }, userId: 'u1' } as any, fakeRes() as any);
    expect(engine.push).toHaveBeenCalledWith('wt-2', { token: 'ghp_account', host: 'github.com' });
  });

  it('browse rejects a non-slug owner/repo before hitting GitHub', async () => {
    const res = fakeRes();
    await ctrl.browseTree({ params: { owner: '../etc', repo: 'x' }, query: {}, userId: 'u1' } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(github.getTree).not.toHaveBeenCalled();
  });

  it('browse threads the stored PAT and returns the tree', async () => {
    await ctrl.setCredential({ userId: 'u1', body: { token: 'ghp_secret' } } as any, fakeRes() as any);
    const res = fakeRes();
    await ctrl.browseTree({ params: { owner: 'octocat', repo: 'Hello-World' }, query: {}, userId: 'u1' } as any, res as any);
    expect(github.getTree).toHaveBeenCalledWith('octocat', 'Hello-World', { branch: undefined, token: 'ghp_secret' });
    expect(res.body).toEqual({ sha: 'x', truncated: false, entries: [] });
  });
});
