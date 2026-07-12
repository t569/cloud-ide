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
});
