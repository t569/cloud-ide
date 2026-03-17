/*
        backend/src/core/SessionManager.ts
*/
import { Session } from './Session';

export class SessionManager {
  // Our universal hashmap: sessionId -> Session instance [cite: 5]
  private sessions: Map<string, Session> = new Map();

  /**
   * Creates a session and adds it to the hashmap [cite: 5]
   */
  public createSession(sessionId: string): Session {
    const session = new Session(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Executes the decouple and teardown logic based on the frontend message 
   */
  public handleDecouple(sessionId: string, strategy: 'DESTROY' | 'STOP' | 'LEAVE_RUNNING'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const container = session.getContainer();

    if (container) {
      switch (strategy) {
        case 'DESTROY':
          // Decouple and destroy container 
          container.destroy();
          break;
        case 'STOP':
          // Decouple and stop container 
          // Stop the container from running but persist it in storage [cite: 4]
          container.stop();
          break;
        case 'LEAVE_RUNNING':
          // Decouple and leave running 
          // We do nothing to the container here; it stays alive!
          break;
      }
    }

    // Invalidate session and remove from hashmap 
    this.sessions.delete(sessionId);
  }
}