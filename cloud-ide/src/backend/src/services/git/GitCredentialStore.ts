// backend/src/services/git/GitCredentialStore.ts
//
// Per-user GitHub PAT storage for the version-control feature (git-integration.md).
//
// The token is a live credential, so it is ENCRYPTED at rest (AES-256-GCM). The key is
// injected — derived from AUTH_SECRET by the composition root (server.ts) — so this
// module has no Express coupling and tests pass their own key. In production AUTH_SECRET
// is env-only, so a leak of the data dir alone can't decrypt the tokens (same posture as
// the identity-cookie signing key). GCM's auth tag means a tampered file fails to decrypt
// rather than yielding garbage.
//
// Same on-disk discipline as the JSON repos: atomic writes + serialized read-modify-write.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../../config/paths';
import { writeJsonAtomic } from '../../database/atomicWrite';

export interface GitCredential {
  /** Remote host the token authenticates to, e.g. 'github.com'. */
  host: string;
  token: string;
}

interface StoredRecord {
  host: string;
  iv: string;
  tag: string;
  ct: string;
  updatedAt: number;
}

export class GitCredentialStore {
  private readonly filePath: string;
  /** Serializes mutations so two overlapping set/clear can't lose each other's write. */
  private chain: Promise<unknown> = Promise.resolve();

  /** @param key 32-byte AES-256 key (inject `deriveKey('git-pat-...')` from auth). */
  constructor(private readonly key: Buffer, dir: string = DATA_DIR) {
    if (key.length !== 32) throw new Error('GitCredentialStore key must be 32 bytes');
    this.filePath = path.join(dir, 'git-credentials.json');
  }

  private encrypt(plain: string): Pick<StoredRecord, 'iv' | 'tag' | 'ct'> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  }

  private decrypt(r: StoredRecord): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(r.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(r.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(r.ct, 'base64')), decipher.final()]).toString('utf8');
  }

  private async read(): Promise<Record<string, StoredRecord>> {
    const raw = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      console.warn('[GitCredentialStore] git-credentials.json unreadable; starting empty.');
      return {};
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  public async set(userId: string, cred: GitCredential): Promise<void> {
    await this.serialize(async () => {
      const db = await this.read();
      db[userId] = { host: cred.host, updatedAt: Date.now(), ...this.encrypt(cred.token) };
      await writeJsonAtomic(this.filePath, db);
    });
  }

  /** Decrypted credential, or null if none stored (or the key no longer decrypts it). */
  public async get(userId: string): Promise<GitCredential | null> {
    const db = await this.read();
    const rec = db[userId];
    if (!rec) return null;
    try {
      return { host: rec.host, token: this.decrypt(rec) };
    } catch {
      // Key rotated or record tampered: treat as no credential (fails closed).
      console.warn(`[GitCredentialStore] could not decrypt token for ${userId}; ignoring.`);
      return null;
    }
  }

  public async clear(userId: string): Promise<void> {
    await this.serialize(async () => {
      const db = await this.read();
      delete db[userId];
      await writeJsonAtomic(this.filePath, db);
    });
  }

  /**
   * key → host for every stored record, WITHOUT decrypting the tokens — for status UIs
   * (e.g. "which workspaces have a token") that need existence + host, never the secret.
   * One file read for the whole set, so a list of N workspaces costs one read, not N.
   */
  public async hosts(): Promise<Record<string, string>> {
    const db = await this.read();
    return Object.fromEntries(Object.entries(db).map(([k, r]) => [k, r.host]));
  }
}
