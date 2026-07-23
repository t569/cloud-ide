// The data-durability contract, against REAL git — mocking exec here would only
// assert which strings we pass, and the whole bug class was about what git actually
// does with them.
//
// The invariant: a sandbox's CHECKOUT is disposable, its BRANCH is not. removeWorktree
// used to `git branch -D` the branch "to keep the repo clean", which made committing
// your work the act that put it at risk — committing leaves the worktree clean, and a
// clean worktree is exactly what destroy() is willing to remove.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorktreeEngine } from './WorktreeEngine';

const execFileAsync = promisify(execFile);
const git = (cwd: string, ...args: string[]) => execFileAsync('git', args, { cwd });

describe('WorktreeEngine — the branch outlives the checkout', () => {
  let root: string;
  let engine: WorktreeEngine;
  let baseRepo: string;
  let worktrees: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-engine-'));
    baseRepo = path.join(root, 'central-repo.git');
    worktrees = path.join(root, 'worktrees');
    engine = new WorktreeEngine(baseRepo, worktrees);
    await engine.initializeBaseRepo();
  }, 30_000);

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const branchExists = (name: string) =>
    git(baseRepo, 'show-ref', '--verify', '--quiet', `refs/heads/${name}`)
      .then(() => true)
      .catch(() => false);

  /** Commit a file in the worktree, the way a user "saves their work" for real. */
  async function commitWork(wt: string, file: string, body: string) {
    await fs.writeFile(path.join(wt, file), body);
    await git(wt, 'add', '.');
    await git(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'work');
  }

  it('keeps the branch (and its commits) when the worktree is removed', async () => {
    const wt = await engine.createWorktree('sbx-a');
    await commitWork(wt, 'important.txt', 'a year of work');

    await engine.removeWorktree('sbx-a');

    // Checkout gone...
    await expect(fs.access(wt)).rejects.toThrow();
    // ...but the history is still reachable. This is the whole point.
    expect(await branchExists('sbx-sbx-a')).toBe(true);
    const { stdout } = await git(baseRepo, 'show', 'sbx-sbx-a:important.txt');
    expect(stdout).toContain('a year of work');
  }, 30_000);

  it('restores a lost checkout from the surviving branch, rather than failing', async () => {
    // A worktree directory can vanish out from under us (a manual cleanup, a bad disk,
    // the fs.rm fallback in removeWorktree). Recovery must still work — and since the
    // branch survives, `add -b` would blow up with "branch already exists" if we did
    // not check the branch out instead. That failure would land on SandboxManager.
    // recover(), the one path whose entire job is not to lose a workspace.
    const wt = await engine.createWorktree('sbx-b');
    await commitWork(wt, 'saved.txt', 'still here');
    await engine.removeWorktree('sbx-b');

    const restored = await engine.createWorktree('sbx-b'); // must not throw

    expect(restored).toBe(wt);
    expect(await fs.readFile(path.join(restored, 'saved.txt'), 'utf-8')).toBe('still here');
  }, 30_000);

  it('reuses an existing checkout untouched — recovery must not reset the workspace', async () => {
    const wt = await engine.createWorktree('sbx-c');
    // Uncommitted work: the case where there is nothing in git to restore FROM, so a
    // re-create that wiped the directory would destroy it outright.
    await fs.writeFile(path.join(wt, 'scratch.txt'), 'unsaved edits');

    const again = await engine.createWorktree('sbx-c');

    expect(again).toBe(wt);
    expect(await fs.readFile(path.join(again, 'scratch.txt'), 'utf-8')).toBe('unsaved edits');
  }, 30_000);

  it('reports a worktree with uncommitted changes as dirty (the destroy pre-flight)', async () => {
    const wt = await engine.createWorktree('sbx-d');
    expect(await engine.isDirty('sbx-d')).toBe(false);

    await fs.writeFile(path.join(wt, 'new.txt'), 'unsaved');
    expect(await engine.isDirty('sbx-d')).toBe(true);
  }, 30_000);

  describe('git operations (real git in the worktree)', () => {
    it('parses status: untracked, added, modified — rename-safe', async () => {
      const wt = await engine.createWorktree('sbx-s');
      await fs.writeFile(path.join(wt, 'tracked.txt'), 'v1');
      await engine.stage('sbx-s');
      await engine.commit('sbx-s', 'seed');

      await fs.writeFile(path.join(wt, 'tracked.txt'), 'v2'); // modify
      await fs.writeFile(path.join(wt, 'fresh.txt'), 'new');  // untracked

      const status = await engine.status('sbx-s');
      const byPath = Object.fromEntries(status.map((e) => [e.path, e.status]));
      expect(byPath['tracked.txt']).toBe(' M');
      expect(byPath['fresh.txt']).toBe('??');
      expect(status).toHaveLength(2); // exactly these — parser didn't misalign
    }, 30_000);

    it('commits a message containing shell metacharacters verbatim (argv, no shell)', async () => {
      const wt = await engine.createWorktree('sbx-inj');
      await fs.writeFile(path.join(wt, 'f.txt'), 'x');
      await engine.stage('sbx-inj');

      // If this were interpolated into a shell string, the injected command would run
      // and/or the subject would be mangled. argv passes it as one literal argument.
      const nasty = 'fix: "$(touch pwned)"; rm -rf / && echo `whoami`';
      await engine.commit('sbx-inj', nasty);

      const log = await engine.log('sbx-inj', 1);
      expect(log[0].subject).toBe(nasty);
      await expect(fs.access(path.join(wt, 'pwned'))).rejects.toThrow(); // no side effect
    }, 30_000);

    it('logs structured entries and diffs an unstaged change', async () => {
      const wt = await engine.createWorktree('sbx-l');
      await fs.writeFile(path.join(wt, 'a.txt'), 'one\n');
      await engine.stage('sbx-l');
      await engine.commit('sbx-l', 'first');

      const log = await engine.log('sbx-l', 5);
      expect(log[0].subject).toBe('first');
      expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/);
      expect(log[0].date).toMatch(/^\d{4}-\d\d-\d\dT/);

      await fs.writeFile(path.join(wt, 'a.txt'), 'two\n');
      const diff = await engine.diff('sbx-l', 'a.txt');
      expect(diff).toContain('-one');
      expect(diff).toContain('+two');
    }, 30_000);

    it('commits ONLY the paths it was given, even with the rest staged', async () => {
      // What makes per-file commit safe without an unstage endpoint: `commit -- <paths>`
      // disregards the index, so a file staged earlier can't ride along uninvited.
      const wt = await engine.createWorktree('sbx-pf');
      await fs.writeFile(path.join(wt, 'seed.txt'), 'x');
      await engine.stage('sbx-pf');
      await engine.commit('sbx-pf', 'seed');

      await fs.writeFile(path.join(wt, 'picked.txt'), 'yes');
      await fs.writeFile(path.join(wt, 'skipped.txt'), 'no');
      await engine.stage('sbx-pf'); // stage BOTH — the trap this guards against
      await engine.commit('sbx-pf', 'only picked', undefined, ['picked.txt']);

      const status = await engine.status('sbx-pf');
      expect(status.map((e) => e.path)).toEqual(['skipped.txt']); // still uncommitted
      const { stdout } = await git(wt, 'show', '--name-only', '--format=', 'HEAD');
      expect(stdout.trim()).toBe('picked.txt');
    }, 30_000);

    it('cloneInto lands a working checkout from a remote', async () => {
      // Build a tiny local bare repo to act as the remote.
      const remote = path.join(root, 'remote.git');
      const seed = path.join(root, 'seed');
      await git(root, 'init', '--bare', remote);
      await git(root, 'clone', remote, seed);
      await fs.writeFile(path.join(seed, 'hello.txt'), 'from remote');
      await git(seed, 'add', '.');
      await git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed');
      await git(seed, 'push', 'origin', 'HEAD');

      const wt = await engine.cloneInto('sbx-clone', remote);

      expect(await fs.readFile(path.join(wt, 'hello.txt'), 'utf-8')).toBe('from remote');
      expect((await engine.log('sbx-clone', 1))[0].subject).toBe('seed');
    }, 30_000);

    it('threads auth without breaking a local clone (host-scoped, inert off github)', async () => {
      // A local-path remote isn't a URL and uses no http transport, so the scoped
      // Authorization header is a harmless no-op — the clone must still succeed. Proves
      // authForUrl's non-URL guard and that credential threading never breaks a clone.
      const remote = path.join(root, 'remote2.git');
      const seed = path.join(root, 'seed2');
      await git(root, 'init', '--bare', remote);
      await git(root, 'clone', remote, seed);
      await fs.writeFile(path.join(seed, 'x.txt'), 'ok');
      await git(seed, 'add', '.');
      await git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 's');
      await git(seed, 'push', 'origin', 'HEAD');

      const wt = await engine.cloneInto('sbx-auth', remote, { token: 'ghp_x' });
      expect(await fs.readFile(path.join(wt, 'x.txt'), 'utf-8')).toBe('ok');
    }, 30_000);
  });
});
