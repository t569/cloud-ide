// Workspaces are DURABLE user state, so the contract is: writes survive, concurrent
// writes don't clobber each other, and owner scoping is honoured. Real files in a temp dir.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonWorkspaceRepository } from './JsonWorkspaceRepository';
import type { WorkspaceRecord } from '../models';

const wsp = (over: Partial<WorkspaceRecord>): WorkspaceRecord => ({
  id: 'wsp-1',
  name: 'demo',
  ownerId: 'user-1',
  ref: 'refs/workspaces/wsp-1',
  source: 'blank',
  persistence: 'persistent',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

describe('JsonWorkspaceRepository', () => {
  let dir: string;
  let repo: JsonWorkspaceRepository;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsrepo-'));
    repo = new JsonWorkspaceRepository(dir);
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('saves and reads back a record', async () => {
    await repo.save(wsp({ id: 'wsp-a', name: 'alpha' }));
    expect((await repo.get('wsp-a'))?.name).toBe('alpha');
    expect(await repo.get('nope')).toBeNull();
  });

  it('deletes a record', async () => {
    await repo.save(wsp({ id: 'wsp-a' }));
    await repo.delete('wsp-a');
    expect(await repo.get('wsp-a')).toBeNull();
  });

  it('scopes listForOwner to the owner (adopting ownerless)', async () => {
    await repo.save(wsp({ id: 'wsp-a', ownerId: 'user-1' }));
    await repo.save(wsp({ id: 'wsp-b', ownerId: 'user-2' }));
    await repo.save(wsp({ id: 'wsp-c', ownerId: '' as any })); // legacy/ownerless → adoptable
    const mine = await repo.listForOwner('user-1');
    expect(mine.map((w) => w.id).sort()).toEqual(['wsp-a', 'wsp-c']);
  });

  it('serializes overlapping writes without a lost update', async () => {
    // Fire N saves concurrently; without serialization the last-read snapshot wins and
    // most records vanish. All must survive.
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => repo.save(wsp({ id: `wsp-${i}` }))),
    );
    expect((await repo.list()).length).toBe(12);
  });

  it('survives an unreadable file rather than throwing', async () => {
    await fs.writeFile(path.join(dir, 'workspaces.json'), '{ not json');
    expect(await repo.list()).toEqual([]); // starts empty, no crash
  });
});
