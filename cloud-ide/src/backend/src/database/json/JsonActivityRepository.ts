// backend/src/database/json/JsonActivityRepository.ts
//
// A per-sandbox audit log on disk (data/activity.json), keyed by sandboxId. Mirrors
// JsonSessionRepository's shape, with one addition: writes are serialized through a
// promise chain. A provision fires several events back-to-back (created, state,
// session_attached), and an unguarded read-modify-write would drop some — an audit
// log that silently loses entries is worse than useless.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ActivityEvent, ActivityKind } from '../models';
import { DATA_DIR } from '../../config/paths';

const MAX_PER_SANDBOX = 200; // ponytail: ring-buffer per sandbox; enough for a drawer, cheap to scan

export class JsonActivityRepository {
  private filePath: string;
  private readonly ready: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(storageDirectory: string = DATA_DIR) {
    this.filePath = path.join(storageDirectory, 'activity.json');
    this.ready = this.initDb();
  }

  private async initDb(): Promise<void> {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify({}));
    }
  }

  private async read(): Promise<Record<string, ActivityEvent[]>> {
    await this.ready;
    return JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
  }

  private async write(data: Record<string, ActivityEvent[]>): Promise<void> {
    await this.ready;
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  /** Serialize a mutation so concurrent bursts can't clobber each other. */
  private mutate(fn: (db: Record<string, ActivityEvent[]>) => void): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const db = await this.read();
      fn(db);
      await this.write(db);
    });
    return this.writeChain;
  }

  public record(
    sandboxId: string,
    kind: ActivityKind,
    message: string,
    actorId?: string,
  ): Promise<void> {
    const event: ActivityEvent = { id: randomUUID(), sandboxId, kind, message, actorId, at: Date.now() };
    return this.mutate((db) => {
      const list = (db[sandboxId] ??= []);
      list.push(event);
      if (list.length > MAX_PER_SANDBOX) db[sandboxId] = list.slice(-MAX_PER_SANDBOX);
    });
  }

  /** Newest first, for the drawer. */
  public async listBySandbox(sandboxId: string, limit = MAX_PER_SANDBOX): Promise<ActivityEvent[]> {
    const db = await this.read();
    return (db[sandboxId] ?? []).slice(-limit).reverse();
  }

  /** Drop a destroyed sandbox's trail — it can no longer be opened to view it. */
  public deleteBySandbox(sandboxId: string): Promise<void> {
    return this.mutate((db) => {
      delete db[sandboxId];
    });
  }
}
