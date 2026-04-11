// backend/src/database/interfaces/ISessionRepository.ts

import { SessionRecord, SessionState } from '../models';

export interface ISessionRepository {
  save(session: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;

  // State Management
  updateState(sessionId: string, state: SessionState): Promise<void>;

  // THE NEW RELATIONAL LINK: Find all users connected to a specific sandbox
  // This is what enables Google Docs-style multiplayer collaboration!
  getSessionsBySandboxId(sandboxId: string): Promise<SessionRecord[]>; 

  // Link a session to infrastructure once Rust finishes provisioning
  linkToSandbox(sessionId: string, sandboxId: string): Promise<void>; 
}