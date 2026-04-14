// src/database/PersistenceLayer.ts

// this file is basically a daeomon to listen to any changes made to our sessions

// backend/src/database/PersistenceLayer.ts

import { EventEmitter } from 'events';
import { ISessionRepository } from './interfaces/ISessionRepository';
import { ISandboxRepository } from './interfaces/ISandboxRepository'; // The new infrastructure repo
import { SandboxState } from '@cloud-ide/shared/types/sandbox';
import { SessionState } from './models';

export class PersistenceLayer {
  constructor(
    private systemEvents: EventEmitter,
    private sessionRepo: ISessionRepository,
    private sandboxRepo: ISandboxRepository // Inject the new repo here
  ) {
    this.startWatching();
  }

  private startWatching(): void {

    // ==========================================
    // 1. INFRASTRUCTURE EVENTS (The Rust Engine)
    // ==========================================

    // When Rust successfully boots the underlying compute node
    this.systemEvents.on('sandbox:provisioned', async (sandboxRecord) => {
      await this.sandboxRepo.save(sandboxRecord);
    });

    // When Rust pauses, stops, or errors out the container
    this.systemEvents.on('sandbox:state_changed', async (data: { sandboxId: string, state: SandboxState }) => {
      await this.sandboxRepo.updateState(data.sandboxId, data.state);
    });

    // When Rust destroys a sandbox entirely
    this.systemEvents.on('sandbox:destroyed', async (sandboxId: string) => {
      // 1. Remove the infrastructure record
      await this.sandboxRepo.delete(sandboxId);
      
      // 2. Cascade down: Kick off any users who were actively connected to this dead sandbox
      const activeSessions = await this.sessionRepo.getSessionsBySandboxId(sandboxId);
      for (const session of activeSessions) {
        await this.sessionRepo.updateState(session.sessionId, 'DISCONNECTED');
      }
    });


    // ==========================================
    // 2. CLIENT EVENTS (The Browser Websockets)
    // ==========================================

    // When a user hits the IDE page and initiates a connection
    this.systemEvents.on('session:connecting', async (sessionRecord) => {
      await this.sessionRepo.save(sessionRecord);
    });

    // When the user's proxy is successfully routed to the running Rust sandbox
    this.systemEvents.on('session:active', async (data: { sessionId: string, sandboxId: string }) => {
      // Link the client to the specific infrastructure and mark as active
      await this.sessionRepo.linkToSandbox(data.sessionId, data.sandboxId);
      await this.sessionRepo.updateState(data.sessionId, 'ACTIVE');
    });

    // When the user closes their browser tab or loses internet
    this.systemEvents.on('session:disconnected', async (sessionId: string) => {
      await this.sessionRepo.updateState(sessionId, 'DISCONNECTED');
      
      // Note: We do NOT destroy the sandbox here! 
      // The sandbox stays running in the background for them to return to.
    });
  }
}