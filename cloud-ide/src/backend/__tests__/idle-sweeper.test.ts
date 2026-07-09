// Scale-to-Zero's one branch. It has already been wrong in both directions: pausing
// a workspace under the user's cursor (no session records existed), then never
// pausing anything at all (session records existed and never left ACTIVE). Liveness
// now comes from WorkspaceWatchers' SSE ref-count, which dies with the tab.
//
// Real timers, and runSweep() is driven directly: fake timers also fake Date.now(),
// so advancing to the next sweep would age the "just booted" fixture out of its own
// grace window and the test would pass for the wrong reason.
import { IdleSweeper } from '../src/services/sandbox/IdleSweeper';
import type { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const HOUR = 60 * 60 * 1000;

const sbx = (over: Partial<SandboxRecord> = {}): SandboxRecord =>
  ({
    sandboxId: 'sbx-1',
    state: 'RUNNING',
    createdAt: Date.now() - HOUR,
    lastActiveAt: Date.now() - HOUR,
    ...over,
  } as SandboxRecord);

function harness(records: SandboxRecord[], viewed: string[] = []) {
  const sandboxManager = {
    pause: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    // Self-healing loop (1a) polls each sandbox's true state before the idle logic.
    getStatus: jest.fn(async (id: string) => ({ sandboxId: id, state: 'RUNNING' })),
  };
  const watchers = { isViewed: (id: string) => viewed.includes(id) };
  const sweeper = new IdleSweeper(
    { list: jest.fn().mockResolvedValue(records) } as any,
    sandboxManager as any,
    watchers as any,
  );
  sweeper.stop(); // we drive runSweep by hand; don't leave the interval armed
  return { sweep: () => (sweeper as any).runSweep(), pause: sandboxManager.pause };
}

describe('IdleSweeper', () => {
  it('pauses only running sandboxes that no editor is viewing', async () => {
    const h = harness(
      [
        sbx({ sandboxId: 'idle-sbx' }),
        sbx({ sandboxId: 'busy-sbx' }),
        sbx({ sandboxId: 'paused-sbx', state: 'PAUSED' }),
      ],
      ['busy-sbx'],
    );

    await h.sweep();

    expect(h.pause).toHaveBeenCalledTimes(1);
    expect(h.pause).toHaveBeenCalledWith('idle-sbx');
  });

  it('grace period spares a just-booted sandbox whose editor has not attached yet', async () => {
    // The failure this prevents: a pause lands between resume() and the SSE connect,
    // so the client's waitForRunning spins on PAUSED until it times out.
    const h = harness([sbx({ lastActiveAt: Date.now() })]);

    await h.sweep();

    expect(h.pause).not.toHaveBeenCalled();
  });

  it('treats a record predating lastActiveAt as old, not as forever-fresh', async () => {
    const h = harness([sbx({ lastActiveAt: undefined })]);

    await h.sweep();

    expect(h.pause).toHaveBeenCalledWith('sbx-1');
  });
});
