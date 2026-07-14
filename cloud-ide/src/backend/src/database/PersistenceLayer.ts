// src/database/PersistenceLayer.ts

// this file is basically a daeomon to listen to any changes made to our sessions

// backend/src/database/PersistenceLayer.ts

import { EventEmitter } from 'events';
import { ISessionRepository } from './interfaces/ISessionRepository';
import { ISandboxRepository } from './interfaces/ISandboxRepository'; // The new infrastructure repo
import { JsonActivityRepository } from './json/JsonActivityRepository';
import { SandboxState } from '@cloud-ide/shared/types/sandbox';
import { SessionState } from './models';

export class PersistenceLayer {
  constructor(
    private systemEvents: EventEmitter,
    private sessionRepo: ISessionRepository,
    private sandboxRepo: ISandboxRepository, // Inject the new repo here
    private activityRepo: JsonActivityRepository // Audit trail for the drawer's Activity log
  ) {
    this.startWatching();
  }

  /**
   * Subscribe an ASYNC handler safely.
   *
   * `emitter.on('x', async () => { … })` hands EventEmitter a promise it does not await
   * and cannot catch: any rejection inside becomes an unhandled rejection, and Node's
   * default is to KILL THE PROCESS. So a single failed write to sessions.json took the
   * entire gateway down with it — every open editor, every terminal — over an audit
   * record. Persistence is a side effect of a request, not the request; it fails loudly
   * in the log and the server keeps serving.
   */
  private on(event: string, handler: (payload: any) => Promise<void>): void {
    this.systemEvents.on(event, (payload) => {
      handler(payload).catch((err) =>
        console.error(`[PersistenceLayer] '${event}' handler failed:`, err),
      );
    });
  }

  private startWatching(): void {

    // ==========================================
    // 1. INFRASTRUCTURE EVENTS (The Rust Engine)
    // ==========================================

    // When Rust successfully boots the underlying compute node
    this.on('sandbox:provisioned', async (sandboxRecord) => {
      await this.sandboxRepo.save(sandboxRecord);
    });

    // When Rust pauses, stops, or errors out the container
    this.on('sandbox:state_changed', async (data: { sandboxId: string, state: SandboxState }) => {
      await this.sandboxRepo.updateState(data.sandboxId, data.state);
    });

    // When Rust destroys a sandbox entirely
    this.on('sandbox:destroyed', async (sandboxId: string) => {
      // 1. Remove the infrastructure record
      await this.sandboxRepo.delete(sandboxId);

      // 2. Cascade down: Kick off any users who were actively connected to this dead sandbox
      const activeSessions = await this.sessionRepo.getSessionsBySandboxId(sandboxId);
      for (const session of activeSessions) {
        await this.sessionRepo.updateState(session.sessionId, 'DISCONNECTED');
      }
      // Note: the activity trail is dropped in SandboxManager.destroy (the real
      // writer); this handler fires only if a `sandbox:destroyed` event is ever emitted.
    });


    // ==========================================
    // 2. CLIENT EVENTS (The Browser Websockets)
    // ==========================================

    // When a user hits the IDE page and initiates a connection
    this.on('session:connecting', async (sessionRecord) => {
      await this.sessionRepo.save(sessionRecord);
    });

    // When the user's proxy is successfully routed to the running Rust sandbox
    this.on('session:active', async (data: { sessionId: string, sandboxId: string }) => {
      // Link the client to the specific infrastructure and mark as active
      await this.sessionRepo.linkToSandbox(data.sessionId, data.sandboxId);
      await this.sessionRepo.updateState(data.sessionId, 'ACTIVE');

      const session = await this.sessionRepo.get(data.sessionId);
      await this.activityRepo.record(data.sandboxId, 'session_attached', 'Session attached', session?.userId);
    });

    // When the user closes their browser tab or loses internet
    this.on('session:disconnected', async (sessionId: string) => {
      // Read the session BEFORE marking it disconnected so we still have its sandbox
      // link and owner to attribute the activity entry.
      const session = await this.sessionRepo.get(sessionId);
      await this.sessionRepo.updateState(sessionId, 'DISCONNECTED');
      if (session?.sandboxId) {
        await this.activityRepo.record(session.sandboxId, 'session_left', 'Session ended', session.userId);
      }

      // Note: We do NOT destroy the sandbox here!
      // The sandbox stays running in the background for them to return to.
    });
  }
}