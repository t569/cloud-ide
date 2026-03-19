// backend/src/controllers/SandboxController.ts


import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { IEnvironmentRepository } from '../database/interfaces/IEnvironmentRepository';
import { ISessionRepository } from '../database/interfaces/ISessionRepository';

export class SandboxController {
  private openSandboxApiUrl: string;

  constructor(
    private systemEvents: EventEmitter,
    private envRepo: IEnvironmentRepository,
    private sessionRepo: ISessionRepository
  ) {
    // This points to where you are running the OpenSandbox FastAPI Server
    // TODO: we need to configure
    this.openSandboxApiUrl = process.env.OPENSANDBOX_API_URL || 'http://localhost:8000';
  }

  /**
   * POST /api/sessions/start
   * Body: { sessionId: string, envId: string, repoUrl: string }
   */
  public startSession = async (req: Request, res: Response): Promise<void> => {
    const { sessionId, envId, repoUrl } = req.body;

    if (!sessionId || !envId) {
      res.status(400).json({ error: 'Missing required fields: sessionId or envId' });
      return;
    }

    try {
      // 1. DATABASE LOOKUP: Get the Docker image tag for this environment
      const environment = await this.envRepo.get(envId);
      if (!environment) {
        res.status(404).json({ error: `Environment '${envId}' not found.` });
        return;
      }

      // 2. CHECK EXISTING SESSION: See if this user already has a paused sandbox
      let session = await this.sessionRepo.get(sessionId);
      let targetSandboxId = session?.openSandboxId;

      // 3. CREATE SANDBOX IF WE HAVE NONE
      if (!targetSandboxId) {
        const imageTag = (environment as any).imageName;
        console.log(`\x1b[36m[API]\x1b[0m Requesting Sandbox for image: ${imageTag}`);

        // Tell OpenSandbox to boot the Docker image
        const sandboxResponse = await fetch(`${this.openSandboxApiUrl}/sandboxes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageTag }),
        });

        // In case sandbox failed to boot
        if (!sandboxResponse.ok) {
          throw new Error(`OpenSandbox engine failed to boot: ${sandboxResponse.statusText}`);
        }

        // Get return data
        const sandboxData = await sandboxResponse.json();

        // FIX: Strict validation ensuring Alibaba actually gave us an ID (Resolves your TODO)
        if (!sandboxData || !sandboxData.id) {
            throw new Error('OpenSandbox API returned an invalid response (missing ID).');
        }
        
        targetSandboxId = sandboxData.id;

        // 4. TRIGGER EVENTS FOR OUR DATABASE TRACKING!
        // The PersistenceLayer daemon listens for this to run sessionRepo.save()
        this.systemEvents.emit('sandbox:provisioned', {
            sessionId,
            envId,
            sandboxId: targetSandboxId, // FIX: Mapped to the correct key expected by the daemon
            mountPath: '/workspace'     // OpenSandbox's default mountpath. TODO: make this more robust
        });
        
      } else {
        console.log(`\x1b[36m[API]\x1b[0m Resuming existing Sandbox: ${targetSandboxId}`);
        // Fire the status change event so the PersistenceLayer updates the DB to 'active'
        this.systemEvents.emit('sandbox:status_changed', { sessionId, status: 'active' });
      }

      // 5. THE HANDOFF: Give the connection details back to the React frontend
      res.status(200).json({
        message: 'Sandbox provisioned successfully',
        sessionId,
        sandboxId: targetSandboxId,
        endpoint: this.openSandboxApiUrl 
      });

    } catch (error: any) {
      console.error('\x1b[31m[SandboxController Error]\x1b[0m', error.message);
      res.status(500).json({ error: 'Failed to provision workspace environment' });
    }
  };

  /**
   * POST /api/sessions/:sessionId/pause
   */
  public pauseSession = async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;

    // Strict Type Guard
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'Invalid or missing sessionId parameter' });
      return;
    }

    try {
      const session = await this.sessionRepo.get(sessionId);
      
      if (!session) {
        res.status(404).json({ error: 'Session not found in database' });
        return;
      }

      if (!session.openSandboxId) {
        res.status(400).json({ error: 'Session does not have an active Sandbox attached' });
        return;
      }

      console.log(`\x1b[33m[API]\x1b[0m Pausing Sandbox: ${session.openSandboxId}`);

      // 1. Tell Alibaba's engine to freeze the container
      const pauseResponse = await fetch(`${this.openSandboxApiUrl}/sandboxes/${session.openSandboxId}/pause`, {
        method: 'POST'
      });

      if (!pauseResponse.ok) {
        throw new Error(`OpenSandbox engine failed to pause: ${pauseResponse.statusText}`);
      }

      // 2. FIRE THE EVENT!
      // The PersistenceLayer will hear this and update the DB status to 'paused'
      this.systemEvents.emit('sandbox:paused', sessionId);

      res.status(200).json({ message: 'Session paused successfully' });
    } catch (error: any) {
      console.error('\x1b[31m[SandboxController Error]\x1b[0m', error.message);
      res.status(500).json({ error: 'Failed to pause session' });
    }
  };

  /**
   * DELETE /api/sessions/:sessionId
   */
  public stopSession = async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;

    // Strict Type Guard for req.params
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'Invalid or missing sessionId parameter' });
      return;
    }

    try {
      const session = await this.sessionRepo.get(sessionId);
      
      // 1. Tell OpenSandbox to kill the container
      if (session?.openSandboxId) {
        await fetch(`${this.openSandboxApiUrl}/sandboxes/${session.openSandboxId}`, {
          method: 'DELETE'
        });
      }

      // 2. FIRE THE EVENT!
      // The PersistenceLayer will hear this and delete the record from the DB.
      this.systemEvents.emit('sandbox:destroyed', sessionId);

      res.status(200).json({ message: 'Session terminated' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to terminate session' });
    }
  };
}