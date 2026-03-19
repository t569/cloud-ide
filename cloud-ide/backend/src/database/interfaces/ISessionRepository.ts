import { SessionRecord } from '../models';

export interface ISessionRepository {
  save(session: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  getSessionsByEnvId(envId: string): Promise<SessionRecord[]>; // The crucial relational link!
  updateStatus(sessionId: string, status: SessionRecord['status']): Promise<void>;
  delete(sessionId: string): Promise<void>;

  // NEW: Store the OpenSandbox ID after provisioning
  updateSandboxId(sessionId: string, sandboxId: string): Promise<void>; 
}
