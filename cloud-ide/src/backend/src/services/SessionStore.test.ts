// Self-check for the recovery interface: round-trip + trust-boundary rejection.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SessionStore } from './SessionStore';

describe('SessionStore', () => {
  let root: string;
  let store: SessionStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sessionstore-'));
    store = new SessionStore(root);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips a snapshot', async () => {
    await store.save('sbx-1', { v: 1, terminalId: 'main', ts: 123, scrollback: 'hello$ ls\r\n' });
    const back = await store.load('sbx-1', 'main');
    expect(back).toEqual({ v: 1, terminalId: 'main', ts: 123, scrollback: 'hello$ ls\r\n' });
  });

  it('returns null when no snapshot exists', async () => {
    expect(await store.load('sbx-1', 'main')).toBeNull();
  });

  it('rejects path-traversal keys instead of escaping the sessions root', async () => {
    await expect(
      store.save('../../etc', { v: 1, terminalId: 'main', ts: 1, scrollback: 'x' }),
    ).rejects.toThrow(/Invalid session key/);
    await expect(store.load('sbx-1', '../secret')).rejects.toThrow(/Invalid session key/);
  });
});
