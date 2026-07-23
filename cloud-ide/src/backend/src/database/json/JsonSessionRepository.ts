// backend/src/database/json/JsonSessionRepository.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { ISessionRepository } from '../interfaces/ISessionRepository';
import { SessionRecord, SessionState } from '../models';
import { DATA_DIR } from '../../config/paths';
import { ensureJsonFile, writeJsonAtomic } from '../atomicWrite';

/**
 * Sessions on disk. Same two rules as JsonSandboxRepository, and for the same reason:
 *
 *  1. Writes are ATOMIC (writeJsonAtomic: temp file + rename). A plain `fs.writeFile`
 *     truncates the file and then fills it, so a reader landing in that window gets an
 *     empty or half-written file. `JSON.parse('')` throws — and since every caller here
 *     is an async EventEmitter listener in PersistenceLayer, that rejection is unhandled
 *     and takes the WHOLE GATEWAY DOWN. Opening a session emits `session:connecting`
 *     (a save) and `session:active` (a link + a state update) back to back, so this was
 *     not a rare interleaving: it was the normal path.
 *
 *  2. Read-modify-write is SERIALIZED on a promise chain. Without it, two overlapping
 *     mutations both read the same snapshot and the second's write erases the first's
 *     record — a lost update, silently.
 */
export class JsonSessionRepository implements ISessionRepository {
  private filePath: string;
  private readonly ready: Promise<void>;
  /** Serializes mutations: one read-modify-write never overlaps the previous one. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storageDirectory: string = DATA_DIR) {
    this.filePath = path.join(storageDirectory, 'sessions.json');
    // ensureJsonFile never rejects — see its doc. A rejection here would be awaited by
    // every read() below and poison the repository permanently.
    this.ready = ensureJsonFile(this.filePath);
  }

  /** Runs `fn` after every mutation queued before it, and hands back its result. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // The chain must not stay rejected, or every later mutation inherits the failure.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Record<string, SessionRecord>> {
    await this.ready;
    const raw = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      // A session is an ephemeral browser connection — it is re-created on the next
      // request. Losing the file is survivable; crashing the gateway over it is not.
      console.warn('[JsonSessionRepository] sessions.json is unreadable; starting empty.');
      return {};
    }
  }

  private mutate(fn: (db: Record<string, SessionRecord>) => void): Promise<void> {
    return this.serialize(async () => {
      const db = await this.read();
      fn(db);
      await writeJsonAtomic(this.filePath, db);
    });
  }

  public async save(session: SessionRecord): Promise<void> {
    await this.mutate((db) => {
      db[session.sessionId] = session;
    });
  }

  public async get(sessionId: string): Promise<SessionRecord | null> {
    const db = await this.read();
    return db[sessionId] || null;
  }

  public async delete(sessionId: string): Promise<void> {
    await this.mutate((db) => {
      delete db[sessionId];
    });
  }

  public async updateState(sessionId: string, state: SessionState): Promise<void> {
    await this.mutate((db) => {
      if (!db[sessionId]) return;
      db[sessionId] = { ...db[sessionId], state, lastPingAt: Date.now() };
    });
  }

  public async getSessionsBySandboxId(sandboxId: string): Promise<SessionRecord[]> {
    const db = await this.read();
    return Object.values(db).filter((session) => session.sandboxId === sandboxId);
  }

  public async linkToSandbox(sessionId: string, sandboxId: string): Promise<void> {
    await this.mutate((db) => {
      if (!db[sessionId]) return;
      db[sessionId] = { ...db[sessionId], sandboxId, lastPingAt: Date.now() };
    });
  }
}