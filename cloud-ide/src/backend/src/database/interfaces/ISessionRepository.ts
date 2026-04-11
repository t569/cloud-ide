// backend/src/database/interfaces/ISessionRepository.ts

import { SessionRecord, SessionState } from '../models';

/**
 * @interface ISessionRepository
 * @description The Client Connection Tracker. Tracks the state and metadata 
 * of a specific user's browser connection to the IDE edge proxy.
 */
export interface ISessionRepository {
  save(session: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;

  // State Management
  updateState(sessionId: string, state: SessionState): Promise<void>;

  /**
   * @description The query that allows the IdleSweeper to calculate if a container 
   * is orphaned, and allows the PersistenceLayer to execute cascade disconnects 
   * if the underlying infrastructure crashes.
   */
  getSessionsBySandboxId(sandboxId: string): Promise<SessionRecord[]>; 

  /**
   * @description Creates the Many-to-One relational link between frontend users 
   * and backend compute once Rust finishes provisioning.
   */
  linkToSandbox(sessionId: string, sandboxId: string): Promise<void>; 
}