// backend/src/core/SessionManager.ts
import { Session } from './Session';

export class SessionManager {
  // The universal registry tracking active I/O streams in memory

  // Ive looke through the logic and i currently see no conflicts with the map and the database functioning
  // NOTE: always check this
  private sessions: Map<string, Session> = new Map();

  public createSession(sessionId: string): Session {
    const session = new Session(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Executes the teardown strategy when a WebSocket drops.
   */
  public handleDecouple(sessionId: string, strategy: 'DESTROY' | 'STOP' | 'LEAVE_RUNNING'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const container = session.getContainer();

    if (container) {
      switch (strategy) {
        case 'DESTROY':
          container.destroy();
          this.sessions.delete(sessionId); 
          break;
          
        case 'STOP':
          container.stop();
          this.sessions.delete(sessionId); 
          break;
          
        case 'LEAVE_RUNNING':
          // CRITICAL: We do NOT delete the session from the map here.
          // The container remains alive, waiting for the user to hijack the stream again.
          console.log(`[Registry] Session ${sessionId} suspended in memory.`);
          break; 
      }
    }
  }
}