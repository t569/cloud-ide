// get() is on the authorization hot path — every guarded request calls it. It must
// never touch the disk after boot, must never hand out a reference into the store,
// and concurrent mutations must not lose updates. Each of those was true of the old
// read-the-whole-file-per-call implementation only by accident, or not at all.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonSandboxRepository } from '../src/database/json/JsonSandboxRepository';
import type { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const rec = (id: string, over: Partial<SandboxRecord> = {}): SandboxRecord =>
  ({
    sandboxId: id,
    userId: 'user-1',
    environmentId: 'my-env',
    worktreeId: 'wt-1',
    state: 'RUNNING',
    desiredVolumes: [],
    workspaceMountPath: '/workspace',
    requiresReprovision: false,
    createdAt: 1,
    ...over,
  }) as SandboxRecord;

let dir: string;
const load = () => new JsonSandboxRepository(dir);
const onDisk = async () => JSON.parse(await fs.readFile(path.join(dir, 'sandboxes.json'), 'utf-8'));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbxrepo-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

it('persists across a restart (the file is still the durable store)', async () => {
  await load().save(rec('sbx-1'));
  expect(await load().get('sbx-1')).toMatchObject({ sandboxId: 'sbx-1' });
});

it('writes through on every mutation', async () => {
  const repo = load();
  await repo.save(rec('sbx-1'));
  expect(Object.keys(await onDisk())).toEqual(['sbx-1']);

  await repo.updateState('sbx-1', 'PAUSED');
  expect((await onDisk())['sbx-1'].state).toBe('PAUSED');

  await repo.delete('sbx-1');
  expect(await onDisk()).toEqual({});
});

it('never reads the file after boot — get() is served from memory', async () => {
  const repo = load();
  await repo.save(rec('sbx-1'));

  const spy = jest.spyOn(fs, 'readFile');
  await repo.get('sbx-1');
  await repo.list();
  await repo.getSandboxesByEnvId('my-env');
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('hands out copies, so a caller cannot mutate the store by accident', async () => {
  const repo = load();
  await repo.save(rec('sbx-1'));

  const got = (await repo.get('sbx-1'))!;
  got.userId = 'attacker';
  expect((await repo.get('sbx-1'))!.userId).toBe('user-1');

  const listed = await repo.list();
  listed[0].state = 'ERROR';
  expect((await repo.get('sbx-1'))!.state).toBe('RUNNING');
});

it('concurrent writes all survive (no read-modify-write lost update)', async () => {
  const repo = load();
  await Promise.all(Array.from({ length: 25 }, (_, i) => repo.save(rec(`sbx-${i}`))));

  expect(Object.keys(await onDisk())).toHaveLength(25);
  expect(await repo.list()).toHaveLength(25);
});

// sandboxes.json is the only index from containers to worktrees. Booting empty is
// fine; destroying the evidence is not — those ids are how you find orphaned work.
it('a corrupt file is preserved, not overwritten, and boot still succeeds', async () => {
  const file = path.join(dir, 'sandboxes.json');
  await fs.writeFile(file, '{ this is not json');

  expect(await load().list()).toEqual([]);

  const quarantined = (await fs.readdir(dir)).find((f) => f.includes('.corrupt-'));
  expect(quarantined).toBeDefined();
  expect(await fs.readFile(path.join(dir, quarantined!), 'utf-8')).toBe('{ this is not json');
  expect(await onDisk()).toEqual({}); // and a fresh, valid file took its place
});
