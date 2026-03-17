// backend/src/core/SessionManager.ts

// this is so we dynamically broadcast events for our database persistence layer to use;
// we are telling it the changes made 
import { EventEmitter } from 'node:events'; 


import { Session } from './Session';

export class SessionManager extends EventEmitter{
  // The universal registry tracking active I/O streams in memory

  // Ive looke through the logic and i currently see no conflicts with the map and the database functioning
  // NOTE: always check this
  private sessions: Map<string, Session> = new Map();

  public createSession(sessionId: string, envId: string, mountPath: string): Session {
    const session = new Session(sessionId);
    this.sessions.set(sessionId, session);

    // Broadcast the boot event to the daemon
    this.emit('session:created', { sessionId, envId, mountPath, status: 'LIVE' });
    
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
          this.emit('session:destroyed', sessionId);
          break;
          
        case 'STOP':
          container.stop();
          this.sessions.delete(sessionId); 
          this.emit('session:status_changed', { sessionId, status: 'SLEEPING' });
          break;
          
        case 'LEAVE_RUNNING':
          // CRITICAL: We do NOT delete the session from the map here.
          // The container remains alive, waiting for the user to hijack the stream again.
          this.emit('session:status_changed', { sessionId, status: 'DETACHED' });
          console.log(`[Registry] Session ${sessionId} suspended in memory.`);
          break; 
      }
    }
  }
}