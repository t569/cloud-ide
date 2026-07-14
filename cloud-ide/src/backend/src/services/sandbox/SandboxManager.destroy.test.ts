// A delete must actually delete.
//
// The container is disposable by construction (the worktree holds the files), so a
// container the daemon can't remove — already forgotten, or wedged in a dead egress
// sidecar's netns — must NOT keep the record alive. It used to: `if (success)` guarded
// the record deletion while the route answered 200 {destroyed:true}, so force-delete
// looked like it worked and the sandbox reappeared on every refetch.
import { SandboxManager } from './SandboxManager';

const record = { sandboxId: 'sbx-1', userId: 'u1', worktreeId: 'wt-1', state: 'ERROR' };

function harness(containerRemovable: boolean) {
  const sandboxRepo = {
    get: jest.fn().mockResolvedValue(record),
    delete: jest.fn().mockResolvedValue(undefined),
  } as any;
  const driver = {
    destroySandbox: containerRemovable
      ? jest.fn().mockResolvedValue(true)
      : jest.fn().mockRejectedValue(new Error('cannot join network namespace of a non running container')),
  } as any;
  const worktreeEngine = {
    isDirty: jest.fn().mockResolvedValue(false),
    removeWorktree: jest.fn().mockResolvedValue(undefined),
  } as any;
  return {
    sandboxRepo,
    driver,
    worktreeEngine,
    manager: new SandboxManager(sandboxRepo, driver, worktreeEngine),
  };
}

describe('SandboxManager.destroy', () => {
  it('removes the record even when the container cannot be removed', async () => {
    const { manager, sandboxRepo, worktreeEngine } = harness(false);

    await expect(manager.destroy('sbx-1', true)).resolves.toBe(true);
    expect(sandboxRepo.delete).toHaveBeenCalledWith('sbx-1');
    expect(worktreeEngine.removeWorktree).toHaveBeenCalledWith('wt-1');
  });

  it('still removes the record on the happy path', async () => {
    const { manager, sandboxRepo, driver } = harness(true);

    await expect(manager.destroy('sbx-1', true)).resolves.toBe(true);
    expect(driver.destroySandbox).toHaveBeenCalledWith('sbx-1');
    expect(sandboxRepo.delete).toHaveBeenCalledWith('sbx-1');
  });
});
