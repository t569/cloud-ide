// src/database/PersistenceLayer.ts

// this file is basically a daeomon to listen to any changes made to our sessions

import { EventEmitter } from 'events';
import { ISessionRepository } from './interfaces/ISessionRepository';

// We pass in a generic Node EventEmitter that our new SandboxController will use
export class PersistenceLayer {
  constructor(
    private systemEvents: EventEmitter,
    private sessionRepo: ISessionRepository
  ) {
    this.startWatching();
  }


  // function to handle events emitted by the session manager
  private startWatching(): void {
    this.systemEvents.on('sandbox:provisioned', async (data) => {
      // 1. Save the initial session
      await this.sessionRepo.save({
        sessionId: data.sessionId,  
        envId: data.envId,
        status: data.status,
        createdAt: data.createdAt,
        openSandboxId: data.openSandboxId,
        mountPath: data.mountPath  
      });
    });

    this.systemEvents.on('sandbox:paused', async (sessionId) => {
      await this.sessionRepo.updateStatus(sessionId, 'paused');
    });

    this.systemEvents.on('sandbox:destroyed', async (sessionId) => {
      await this.sessionRepo.delete(sessionId);
    });
  }
}