// The branch the whole lifecycle hangs on. A record's `state` is a CACHE of Docker's,
// and after a dockerd/WSL/host restart a "paused" container is actually exited — the
// daemon then refuses the resume with 409 SANDBOX_NOT_PAUSED. Every one of these cases
// used to end with a caller believing it had a live sandbox when it had nothing.
//
// The invariant these pin: ensureRunning ALWAYS hands back an id you can connect to, and
// NEVER lets a dead container cost the user their worktree.
import { SandboxManager } from '../src/services/sandbox/SandboxManager';
import type { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const record = (over: Partial<SandboxRecord> = {}): SandboxRecord =>
  ({
    sandboxId: 'sbx-old',
    userId: 'user-1',
    worktreeId: 'wt-1',
    environmentId: 'env-1',
    state: 'PAUSED',
    desiredVolumes: [],
    createdAt: Date.now(),
    ...over,
  } as SandboxRecord);

/** `engine` is what the daemon really says, which is the whole point: it may disagree
 *  with the stored record. 'GONE' makes getSandboxStatus throw, as a 404 does. */
function harness(
  stored: SandboxRecord,
  engine: SandboxRecord['state'] | 'GONE',
  resumeSucceeds = true,
) {
  const saved: SandboxRecord[] = [];
  const sandboxRepo = {
    get: jest.fn(async () => stored),
    save: jest.fn(async (r: SandboxRecord) => void saved.push(r)),
    updateState: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(async () => [stored]),
  };
  const driver = {
    getSandboxStatus: jest.fn(async (id: string) => {
      if (engine === 'GONE') throw new Error('404: no such sandbox');
      return { sandboxId: id, state: engine };
    }),
    resumeSandbox: jest.fn(async () => resumeSucceeds),
    destroySandbox: jest.fn(async () => true),
    bootSandbox: jest.fn(async () => ({ sandboxId: 'sbx-new', state: 'RUNNING' })),
    capabilities: () => ({ exec: true, pty: false }),
  };
  const worktreeEngine = {
    initializeBaseRepo: jest.fn(async () => {}),
    // Idempotent by contract: it hands back the EXISTING worktree, files and all.
    createWorktree: jest.fn(async (id: string) => `/data/worktrees/${id}`),
    removeWorktree: jest.fn(async () => {}),
  };
  const envRepo = {
    get: jest.fn(async () => ({ id: 'env-1', imageName: 'cloud-ide-env-1:abc', createdAt: 0 })),
  };

  const manager = new SandboxManager(
    sandboxRepo as any,
    driver as any,
    worktreeEngine as any,
    undefined,
    envRepo as any,
  );
  return { manager, driver, worktreeEngine, saved };
}

describe('SandboxManager.ensureRunning', () => {
  it('reuses a sandbox the daemon says is already running', async () => {
    const h = harness(record({ state: 'PAUSED' }), 'RUNNING'); // record is STALE

    expect(await h.manager.ensureRunning('sbx-old')).toBe('sbx-old');
    expect(h.driver.resumeSandbox).not.toHaveBeenCalled();
    expect(h.driver.bootSandbox).not.toHaveBeenCalled();
  });

  it('resumes a genuinely paused sandbox, keeping its id', async () => {
    const h = harness(record(), 'PAUSED');

    expect(await h.manager.ensureRunning('sbx-old')).toBe('sbx-old');
    expect(h.driver.resumeSandbox).toHaveBeenCalledWith('sbx-old');
    expect(h.driver.bootSandbox).not.toHaveBeenCalled();
  });

  // THE BUG. The record says PAUSED; the container is exited, so the daemon 409s the
  // resume. This used to report success and hand back an id pointing at nothing.
  it('recovers onto the same worktree when the daemon refuses to resume (the 409)', async () => {
    const h = harness(record(), 'PAUSED', /* resumeSucceeds */ false);

    expect(await h.manager.ensureRunning('sbx-old')).toBe('sbx-new');
    expect(h.worktreeEngine.createWorktree).toHaveBeenCalledWith('wt-1'); // same files
    expect(h.worktreeEngine.removeWorktree).not.toHaveBeenCalled(); // never the workspace
  });

  it.each(['STOPPED', 'ERROR', 'GONE'] as const)(
    'recovers onto the same worktree when the container is %s',
    async (engine) => {
      const h = harness(record({ state: 'PAUSED' }), engine);

      expect(await h.manager.ensureRunning('sbx-old')).toBe('sbx-new');
      expect(h.worktreeEngine.createWorktree).toHaveBeenCalledWith('wt-1');
      expect(h.worktreeEngine.removeWorktree).not.toHaveBeenCalled();
    },
  );
});

describe('SandboxManager.releaseCompute', () => {
  it('destroys the container but keeps the record and its worktree', async () => {
    const h = harness(record(), 'PAUSED');

    await h.manager.releaseCompute('sbx-old');

    expect(h.driver.destroySandbox).toHaveBeenCalledWith('sbx-old');
    expect(h.worktreeEngine.removeWorktree).not.toHaveBeenCalled();
    expect(h.saved.at(-1)).toMatchObject({ sandboxId: 'sbx-old', worktreeId: 'wt-1', state: 'STOPPED' });
  });
});
