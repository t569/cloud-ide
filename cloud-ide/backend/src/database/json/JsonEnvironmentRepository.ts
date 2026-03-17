import fs from 'node:fs/promises';
import path from 'node:path';
import { IEnvironmentRepository } from '../IEnvironmentRepository';
import { EnvironmentRecord } from '../models';

export class JsonEnvironmentRepository implements IEnvironmentRepository {
  private filePath: string;

  constructor(storageDirectory: string = './data') {
    this.filePath = path.join(storageDirectory, 'environments.json');
    this.initDb();
  }

  private async initDb(): Promise<void> {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify({}));
    }
  }

  private async read(): Promise<Record<string, EnvironmentRecord>> {
    const data = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async write(data: Record<string, EnvironmentRecord>): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
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