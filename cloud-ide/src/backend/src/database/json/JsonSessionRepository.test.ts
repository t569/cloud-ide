// Opening a session fires `session:connecting` (a save) and `session:active` (a link +
// a state update) back to back, and PersistenceLayer's handlers are async — so these
// read-modify-writes overlap. With a plain `fs.writeFile` (truncate, then fill), the
// reader in that window got an empty file, `JSON.parse('')` threw inside an async
// EventEmitter listener, and the unhandled rejection killed the whole gateway.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonSessionRepository } from './JsonSessionRepository';
import { SessionRecord } from '../models';

const session = (id: string): SessionRecord => ({
  sessionId: id,
  userId: 'u1',
  sandboxId: '',
  state: 'CONNECTING',
  connectedAt: Date.now(),
  lastPingAt: Date.now(),
});

describe('JsonSessionRepository under concurrent writes', () => {
  let dir: string;
  let repo: JsonSessionRepository;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    repo = new JsonSessionRepository(dir);
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('survives an overlapping save + link + updateState, and keeps every field', async () => {
    // Exactly the launch path: no awaits between the emits.
    await Promise.all([
      repo.save(session('sess-1')),
      repo.linkToSandbox('sess-1', 'sbx-1'),
      repo.updateState('sess-1', 'ACTIVE'),
    ]);

    const stored = await repo.get('sess-1');
    expect(stored).not.toBeNull();
    expect(stored!.sandboxId).toBe('sbx-1');
    expect(stored!.state).toBe('ACTIVE');
  });

  it('does not lose records when many sessions are written at once', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `sess-${i}`);
    await Promise.all(ids.map((id) => repo.save(session(id))));

    // A non-serialized read-modify-write drops records: each writer persists the
    // snapshot it read, so the last one wins and the rest vanish.
    const found = await Promise.all(ids.map((id) => repo.get(id)));
    expect(found.filter(Boolean)).toHaveLength(ids.length);
  });

  it('starts empty rather than throwing when the file is truncated', async () => {
    await fs.writeFile(path.join(dir, 'sessions.json'), '');
    await expect(repo.get('sess-1')).resolves.toBeNull();
  });
});
