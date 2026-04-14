import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxRecord, SandboxState } from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../interfaces/ISandboxRepository';

export class JsonSandboxRepository implements ISandboxRepository {
  private filePath: string;
  private readonly ready: Promise<void>;

  constructor(storageDirectory: string = './data') {
    this.filePath = path.join(storageDirectory, 'sandboxes.json');
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

  private async read(): Promise<Record<string, SandboxRecord>> {
    await this.ready;
    const data = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async write(data: Record<string, SandboxRecord>): Promise<void> {
    await this.ready;
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  public async save(sandbox: SandboxRecord): Promise<void> {
    const db = await this.read();
    db[sandbox.sandboxId] = sandbox;
    await this.write(db);
  }

  public async get(sandboxId: string): Promise<SandboxRecord | null> {
    const db = await this.read();
    return db[sandboxId] || null;
  }

  public async delete(sandboxId: string): Promise<void> {
    const db = await this.read();
    delete db[sandboxId];
    await this.write(db);
  }

  public async updateState(sandboxId: string, state: SandboxState): Promise<void> {
    const db = await this.read();
    if (!db[sandboxId]) {
      return;
    }

    db[sandboxId] = {
      ...db[sandboxId],
      state,
    };
    await this.write(db);
  }

  public async getSandboxesByEnvId(envId: string): Promise<SandboxRecord[]> {
    const db = await this.read();
    return Object.values(db).filter((sandbox) => sandbox.environmentId === envId);
  }

  public async list(): Promise<SandboxRecord[]> {
    const db = await this.read();
    return Object.values(db);
  }
}
