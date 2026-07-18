// The contract: a PAT is stored ENCRYPTED and comes back only with the right key.
// If the plaintext ever hits disk, or a rotated key silently returns garbage, the
// whole "safe to keep a token server-side" premise is void — so those are the tests.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitCredentialStore } from './GitCredentialStore';

const KEY = crypto.randomBytes(32);
const TOKEN = 'ghp_supersecrettoken1234567890ABCDEF';

describe('GitCredentialStore', () => {
  let dir: string;
  let store: GitCredentialStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcred-'));
    store = new GitCredentialStore(KEY, dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('round-trips a credential (host + token)', async () => {
    await store.set('user-a', { host: 'github.com', token: TOKEN });
    expect(await store.get('user-a')).toEqual({ host: 'github.com', token: TOKEN });
  });

  it('never writes the plaintext token to disk', async () => {
    await store.set('user-a', { host: 'github.com', token: TOKEN });
    const onDisk = await fs.readFile(path.join(dir, 'git-credentials.json'), 'utf-8');
    expect(onDisk).not.toContain(TOKEN);
    expect(onDisk).toContain('github.com'); // host is not secret
  });

  it('isolates users and returns null for the unknown', async () => {
    await store.set('user-a', { host: 'github.com', token: TOKEN });
    await store.set('user-b', { host: 'gitlab.com', token: 'other' });
    expect((await store.get('user-a'))?.token).toBe(TOKEN);
    expect((await store.get('user-b'))?.host).toBe('gitlab.com');
    expect(await store.get('nobody')).toBeNull();
  });

  it('clears a credential', async () => {
    await store.set('user-a', { host: 'github.com', token: TOKEN });
    await store.clear('user-a');
    expect(await store.get('user-a')).toBeNull();
  });

  it('fails closed when the key no longer decrypts (rotation/tamper)', async () => {
    await store.set('user-a', { host: 'github.com', token: TOKEN });
    const otherKey = new GitCredentialStore(crypto.randomBytes(32), dir);
    expect(await otherKey.get('user-a')).toBeNull(); // not a throw, not garbage
  });

  it('rejects a wrong-size key at construction', () => {
    expect(() => new GitCredentialStore(crypto.randomBytes(16), dir)).toThrow();
  });
});
