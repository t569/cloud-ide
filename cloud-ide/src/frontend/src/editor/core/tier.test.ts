// Does the browser tier actually run? These assert the property that makes it work at all:
// the FileStore and the GitPort address ONE tree, so a file the editor writes is a file git
// can see. They are separate classes over OPFS, and nothing but a test guarantees they
// agree — a mismatch would look like commits that silently miss the user's edits.
import { describe, it, expect } from 'vitest';
import { createTier, WORKSPACE_DIR } from './tier';
import { fakeOpfsRoot } from '../../vfs/fakeOpfs';
import { HttpFileStore } from '../../vfs/HttpFileStore';
import { HttpGitPort } from '../../vfs/HttpGitPort';

const browserTier = () => {
  const root = fakeOpfsRoot();
  return createTier({ sandboxId: 'sbx-1', tier: 'browser', getStorageRoot: async () => root });
};

describe('createTier — server (default)', () => {
  it('keeps today\'s behaviour and declares it has a sandbox', () => {
    const tier = createTier({ sandboxId: 'sbx-1' });
    expect(tier.kind).toBe('server');
    expect(tier.files).toBeInstanceOf(HttpFileStore);
    expect(tier.git).toBeInstanceOf(HttpGitPort);
    expect(tier.hasSandbox).toBe(true);
  });
});

describe('createTier — browser', () => {
  it('declares no sandbox, so terminal/preview/LSP/FS-events stay off', () => {
    expect(browserTier().hasSandbox).toBe(false);
  });

  it('ensureReady is idempotent — every boot, not just the first', async () => {
    const tier = browserTier();
    await tier.ensureReady();
    await tier.ensureReady(); // mkdir EEXIST + git init on an existing repo must not throw
    expect(await tier.git.branch()).toBe('main');
  }, 30_000);

  // THE integration property: two independent classes over OPFS, one tree.
  it('a file written through the STORE is seen by GIT, and commits', async () => {
    const tier = browserTier();
    await tier.ensureReady();

    await tier.files.write(`${WORKSPACE_DIR}/hello.txt`, 'written by the editor');
    expect(await tier.git.status()).toEqual([{ status: '??', path: 'hello.txt' }]);

    await tier.git.commit('from the editor');
    expect(await tier.git.status()).toEqual([]);

    const [entry] = await tier.git.log();
    expect(entry.subject).toBe('from the editor');
  }, 30_000);

  it('survives a reload: a second tier on the same storage sees the repo and files', async () => {
    // Two tiers over one root is exactly what reopening the tab does — the point of OPFS
    // is that the work is still there with no server having held anything.
    const root = fakeOpfsRoot();
    const first = createTier({ sandboxId: 'sbx-1', tier: 'browser', getStorageRoot: async () => root });
    await first.ensureReady();
    await first.files.write(`${WORKSPACE_DIR}/keep.txt`, 'persisted');
    await first.git.commit('before reload');

    const second = createTier({ sandboxId: 'sbx-1', tier: 'browser', getStorageRoot: async () => root });
    await second.ensureReady();
    expect(await second.files.read(`${WORKSPACE_DIR}/keep.txt`)).toBe('persisted');
    expect((await second.git.log())[0].subject).toBe('before reload');
  }, 30_000);

  it('keeps two workspaces apart in one browser', async () => {
    const root = fakeOpfsRoot();
    const mine = createTier({ sandboxId: 's', workspaceId: 'wsp-mine', tier: 'browser', getStorageRoot: async () => root });
    const yours = createTier({ sandboxId: 's', workspaceId: 'wsp-yours', tier: 'browser', getStorageRoot: async () => root });
    await mine.ensureReady();
    await yours.ensureReady();

    await mine.files.write(`${WORKSPACE_DIR}/secret.txt`, 'mine');

    // Not "empty" — each namespace has its own .git after ensureReady. The claim is that
    // one workspace's files are unreachable from the other. (The VFS hides .git from the
    // tree via isHiddenPath; the store lists it faithfully, which is the store's job.)
    const theirs = await yours.files.list(WORKSPACE_DIR);
    expect(theirs.map((e) => e.name)).not.toContain('secret.txt');
    await expect(yours.files.read(`${WORKSPACE_DIR}/secret.txt`)).rejects.toThrow();
  }, 30_000);
});
