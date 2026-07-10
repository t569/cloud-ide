// Self-check for the DELETE /environment/:id guard. The bug this replaces: the guard
// queried sessions (a stub returning []) instead of sandboxes, so it never blocked and
// deleted environments out from under running sandboxes. These cases pin the contract:
// a live sandbox blocks (409, env survives); a dead/absent one does not (env deleted).
import { createEnvironmentRouter } from './environment.routes';
import { IEnvironmentRepository, ISandboxRepository } from '../../database/interfaces';
import type { SandboxRecord, SandboxState } from '@cloud-ide/shared/types/sandbox';

type Res = { statusCode: number; body: any };

function fakeRes(): Res & { status: (c: number) => Res & any; json: (b: any) => void } {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: any) => ((res.body = b), res);
  return res;
}

// Pull the DELETE handler out of the router's stack by path + method.
function deleteHandler(envRepo: IEnvironmentRepository, sandboxRepo: ISandboxRepository) {
  const router: any = createEnvironmentRouter(envRepo, sandboxRepo, {} as any);
  const layer = router.stack.find(
    (l: any) => l.route?.path === '/:envId' && l.route?.methods?.delete,
  );
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

const envRepo = (deleted: string[]): IEnvironmentRepository =>
  ({
    delete: async (id: string) => void deleted.push(id),
  } as any);

const sandboxRepo = (states: SandboxState[]): ISandboxRepository =>
  ({
    getSandboxesByEnvId: async (envId: string): Promise<SandboxRecord[]> =>
      states.map((state, i) => ({ sandboxId: `sbx-${i}`, environmentId: envId, state } as SandboxRecord)),
  } as any);

async function run(states: SandboxState[]) {
  const deleted: string[] = [];
  const handler = deleteHandler(envRepo(deleted), sandboxRepo(states));
  const res = fakeRes();
  await handler({ params: { envId: 'env-1' } }, res);
  return { res, deleted };
}

describe('DELETE /environment/:id guard', () => {
  it('409s and does NOT delete when a RUNNING sandbox depends on the env', async () => {
    const { res, deleted } = await run(['RUNNING']);
    expect(res.statusCode).toBe(409);
    expect(deleted).toEqual([]);
  });

  it('blocks on PAUSED and PROVISIONING too (warm / coming-up compute)', async () => {
    expect((await run(['PAUSED'])).res.statusCode).toBe(409);
    expect((await run(['PROVISIONING'])).res.statusCode).toBe(409);
  });

  it('deletes when the only sandboxes are STOPPED/ERROR (dead records)', async () => {
    const { res, deleted } = await run(['STOPPED', 'ERROR']);
    expect(res.statusCode).toBe(200);
    expect(deleted).toEqual(['env-1']);
  });

  it('deletes when no sandbox references the env', async () => {
    const { res, deleted } = await run([]);
    expect(res.statusCode).toBe(200);
    expect(deleted).toEqual(['env-1']);
  });
});
