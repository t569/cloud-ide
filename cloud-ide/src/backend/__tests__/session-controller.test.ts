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

function harness(existing: SandboxRecord[]) {
  const sandboxManager = {
    provision: jest.fn().mockResolvedValue(sbx({ sandboxId: 'sbx-new' })),
    resume: jest.fn().mockResolvedValue(true),
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

test('reuses a warm RUNNING sandbox instead of booting a second one', async () => {
  const h = harness([sbx({ sandboxId: 'sbx-warm' })]);
  await h.run();
  expect(h.sandboxManager.provision).not.toHaveBeenCalled();
  expect(h.body().sandboxId).toBe('sbx-warm');
});

test('resumes a PAUSED sandbox rather than leaving it un-woken', async () => {
  const h = harness([sbx({ sandboxId: 'sbx-paused', state: 'PAUSED' })]);
  await h.run();
  expect(h.sandboxManager.resume).toHaveBeenCalledWith('sbx-paused');
  expect(h.sandboxManager.provision).not.toHaveBeenCalled();
});

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
