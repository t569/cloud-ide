// The launch path's one job: never run two containers for one env.
jest.mock('../src/config/env', () => ({ config: { PUBLIC_API_URL: 'http://localhost:3000' } }));
jest.mock('../src/api/middleware/security', () => ({ SID_COOKIE: 'sid', SESSION_COOKIE_OPTIONS: {} }));
jest.mock('../src/api/middleware/auth', () => ({ currentUser: () => 'user-1' }));

import { EventEmitter } from 'events';
import { SessionController } from '../src/controllers/SessionController';
import type { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const ENV = { id: 'my-env', imageName: 'cloud-ide-my-env:abc123', builderConfig: { env: { PORT: '3000' } } };

const sbx = (over: Partial<SandboxRecord>): SandboxRecord =>
  ({ sandboxId: 'sbx-1', userId: 'user-1', state: 'RUNNING', ...over } as SandboxRecord);

/**
 * SessionController's own job is CANDIDATE SELECTION: which record (if any) this launch
 * should attach to. Turning that record into a live container — resume, or recover onto
 * its worktree when the container is dead — is `SandboxManager.ensureRunning`, and its
 * branches are pinned in ensure-running.test.ts. So the fake returns a fixed live id and
 * we assert only on the choice: did we route an existing record through ensureRunning,
 * or did we cold-boot a second container?
 */
function harness(existing: SandboxRecord[]) {
  const sandboxManager = {
    provision: jest.fn().mockResolvedValue(sbx({ sandboxId: 'sbx-new' })),
    ensureRunning: jest.fn(async (id: string) => (id === 'sbx-dead' ? 'sbx-recovered' : id)),
  };
  const sandboxRepo = { getSandboxesByEnvId: jest.fn().mockResolvedValue(existing) };
  const controller = new SessionController(
    new EventEmitter(),
    { get: jest.fn(), save: jest.fn(), linkToSandbox: jest.fn() } as any,
    sandboxRepo as any,
    sandboxManager as any,
    { get: jest.fn().mockResolvedValue(ENV) } as any,
  );
  const res: any = { cookie: jest.fn(), status: jest.fn(() => res), json: jest.fn(() => res) };
  const run = () => controller.startSession({ body: { environmentId: ENV.id } } as any, res);
  return { run, res, sandboxManager, sandboxRepo, body: () => res.json.mock.calls.at(-1)[0] };
}

test('reuses a warm sandbox instead of booting a second one', async () => {
  const h = harness([sbx({ sandboxId: 'sbx-warm' })]);
  await h.run();
  expect(h.sandboxManager.ensureRunning).toHaveBeenCalledWith('sbx-warm');
  expect(h.sandboxManager.provision).not.toHaveBeenCalled();
  expect(h.body().sandboxId).toBe('sbx-warm');
});

// THE BUG THIS EXISTS TO CATCH: a container paused for a long time does not survive a
// dockerd/WSL/host restart. Reuse only matched RUNNING or PAUSED, so an ERROR record fell
// through to a cold provision() — which mints a BRAND-NEW worktree. The user's files were
// still on disk, but nothing pointed at them, and the editor opened an empty workspace. A
// record with a dead container is still the ONLY pointer to that worktree: it must be
// picked as the candidate, never skipped in favour of a fresh empty one.
test.each(['ERROR', 'STOPPED', 'PAUSED'] as const)(
  'a %s record is recovered onto its worktree, not abandoned for a cold boot',
  async (state) => {
    const h = harness([sbx({ sandboxId: 'sbx-dead', state, worktreeId: 'wt-keepme' })]);
    await h.run();

    expect(h.sandboxManager.ensureRunning).toHaveBeenCalledWith('sbx-dead');
    expect(h.sandboxManager.provision).not.toHaveBeenCalled(); // a cold boot would strand the worktree
    // Recovery re-provisions, so the id changes. The session must hand back the NEW one.
    expect(h.body().sandboxId).toBe('sbx-recovered');
  },
);

test("never adopts another user's sandbox; cold-boots with the stored tag + envVars", async () => {
  const h = harness([sbx({ sandboxId: 'sbx-theirs', userId: 'user-2' })]);
  await h.run();
  expect(h.sandboxManager.provision).toHaveBeenCalledWith(
    { imageTag: ENV.imageName, environmentId: ENV.id, envVars: ENV.builderConfig.env },
    'user-1',
  );
  expect(h.body().sandboxId).toBe('sbx-new');
});

// The bug this exists to catch: provision() used to stamp the record with
// spec.imageTag, while lookup queries by env id. They never matched, so warm reuse
// silently never fired and every launch booted a second container. Mocking the repo
// hid it — so assert the value we STORE is the value we LOOK UP BY, and that it is
// the env id (an image tag is rebuild-unstable and would break reuse on every build).
test('the id provision stores is the id reuse queries by', async () => {
  const h = harness([]);
  await h.run();
  const [spec] = h.sandboxManager.provision.mock.calls[0];
  const [queriedWith] = h.sandboxRepo.getSandboxesByEnvId.mock.calls[0];
  expect(spec.environmentId).toBe(queriedWith);
  expect(spec.environmentId).toBe(ENV.id);
  expect(spec.environmentId).not.toBe(ENV.imageName);
});

test('an unbuilt environment is rejected, not booted', async () => {
  const controller = new SessionController(
    new EventEmitter(),
    {} as any,
    { getSandboxesByEnvId: jest.fn() } as any,
    { provision: jest.fn() } as any,
    { get: jest.fn().mockResolvedValue({ ...ENV, imageName: '' }) } as any,
  );
  const res: any = { cookie: jest.fn(), status: jest.fn(() => res), json: jest.fn(() => res) };
  await controller.startSession({ body: { environmentId: ENV.id } } as any, res);
  expect(res.status).toHaveBeenCalledWith(409);
});
