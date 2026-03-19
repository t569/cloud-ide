// backend/src/database/json/JsonSessionRepository.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { ISessionRepository } from '../interfaces/ISessionRepository';
import { SessionRecord } from '../models';

export class JsonSessionRepository implements ISessionRepository {
  private filePath: string;

  constructor(storageDirectory: string = './data') {
    this.filePath = path.join(storageDirectory, 'sessions.json');
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

  private async read(): Promise<Record<string, SessionRecord>> {
    const data = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async write(data: Record<string, SessionRecord>): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  public async save(session: SessionRecord): Promise<void> {
    const db = await this.read();
    db[session.sessionId] = session;
    await this.write(db);
  }

  public async get(sessionId: string): Promise<SessionRecord | null> {
    const db = await this.read();
    return db[sessionId] || null;
  }

  public async getSessionsByEnvId(envId: string): Promise<SessionRecord[]> {
    const db = await this.read();
    return Object.values(db).filter(session => session.envId === envId);
  }

  public async updateStatus(sessionId: string, status: SessionRecord['status']): Promise<void> {
    const db = await this.read();
    if (db[sessionId]) {
      db[sessionId].status = status;
      await this.write(db);
    }
  }

  // NEW: Saves the OpenSandbox ID to our JSON database
  public async updateSandboxId(sessionId: string, sandboxId: string): Promise<void> {
    const db = await this.read();
    if (db[sessionId]) {
      db[sessionId].openSandboxId = sandboxId;
      await this.write(db);
    }
  }

  public async delete(sessionId: string): Promise<void> {
    const db = await this.read();
    delete db[sessionId];
    await this.write(db);
  }
}