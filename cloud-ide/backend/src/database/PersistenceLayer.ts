// src/database/PersistenceLayer.ts

// this file is basically a daeomon to listen to any changes made to our sessions

import { SessionManager } from '../core/SessionManager';
import { ISessionRepository } from './ISessionRepository';

// pass in both our database and our sessionmanager to start the tracking
export class PersistenceLayer {
  constructor(
    private sessionManager: SessionManager,
    private sessionRepo: ISessionRepository
  ) {
    this.startWatching();
  }


  // function to handle events emitted by the session manager
  private startWatching(): void {
    this.sessionManager.on('session:created', async (data) => {
      await this.sessionRepo.save({
        sessionId: data.sessionId,
        envId: data.envId,
        status: data.status,
        mountPath: data.mountPath,
        createdAt: Date.now()
      });
    });

    this.sessionManager.on('session:status_changed', async (data) => {
      await this.sessionRepo.updateStatus(data.sessionId, data.status);
    });

    this.sessionManager.on('session:destroyed', async (sessionId) => {
      await this.sessionRepo.delete(sessionId);
    });
  }
}