import fs from 'node:fs/promises';
import path from 'node:path';
import { IEnvironmentRepository } from '../interfaces/IEnvironmentRepository';
import { EnvironmentRecord } from '../models';
import { ensureJsonFile, writeJsonAtomic } from '../atomicWrite';
import { DATA_DIR } from '../../config/paths';

export class JsonEnvironmentRepository implements IEnvironmentRepository {
  private filePath: string;

  constructor(storageDirectory: string = DATA_DIR) {
    this.filePath = path.join(storageDirectory, 'environments.json');
    // Deliberately unawaited, so it must never reject: this promise is dropped on the
    // floor, and an unhandled rejection here is a process-level event.
    void ensureJsonFile(this.filePath);
  }

  private async read(): Promise<Record<string, EnvironmentRecord>> {
    const data = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async write(data: Record<string, EnvironmentRecord>): Promise<void> {
    await writeJsonAtomic(this.filePath, data);
  }

  public async save(env: EnvironmentRecord): Promise<void> {
    const db = await this.read();
    db[env.id] = env;
    await this.write(db);
  }

  public async get(id: string): Promise<EnvironmentRecord | null> {
    const db = await this.read();
    return db[id] || null;
  }

  public async list(): Promise<EnvironmentRecord[]> {
    const db = await this.read();
    return Object.values(db);
  }

  public async delete(id: string): Promise<void> {
    const db = await this.read();
    delete db[id];
    await this.write(db);
  }
}