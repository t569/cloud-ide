// backend/src/controllers/SandboxController.ts


import { Request, Response } from 'express';
import { IEnvironmentRepository } from 'src/database/interfaces/IEnvironmentRepository';
import { ISessionRepository } from 'src/database/interfaces/ISessionRepository';
import { EventEmitter } from 'events';
import { OpenSandboxRouter } from '../services/OpenSandboxRouter';
import { config } from '../config/env';

// volume mounts for our session
import { WorkspaceProvisioner, GitStrategy, LocalBindStrategy } from '../services/WorkspaceProvisioner';
import { SessionRecord } from 'src/database/models';


export class SandboxController {
  
  // the router that talks to our sandbox backend
  private router: OpenSandboxRouter;
  private openSandboxApiUrl: string;
  constructor(
    private systemEvents: EventEmitter,
    private envRepo: IEnvironmentRepository,
    private sessionRepo: ISessionRepository,
  ) {
    // This points to where you are running the OpenSandbox FastAPI Server
    // TODO: route config later
    this.openSandboxApiUrl = 'http://localhost:8080';

    // initialise router  
    this.router = new OpenSandboxRouter();
  }

  /**
   * POST /api/sessions/start
   * Body: { sessionId: string, envId: string, repoUrl: string }
   */

  // ERROR: all requests and responses here are flawed, we need an api
 public startSession = async (req: Request, res: Response): Promise<void> => {
  // repoUrl and localPath are optional
    const { sessionId, envId, repoUrl, localPath } = req.body;

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

      // 2. INITIALIZE THE CORRECT PROVISIONING STRATEGY
      let provisioner: WorkspaceProvisioner | null = null;
      if (repoUrl) {
        provisioner = new WorkspaceProvisioner(new GitStrategy(repoUrl));
      } else if (localPath) {
        provisioner = new WorkspaceProvisioner(new LocalBindStrategy(localPath));
      }

      // Get any pre-boot Docker volumes from the strategy (Empty array if Git, Host path if Local)
      const bootVolumes = provisioner ? provisioner.getBootVolumes() : [];

      console.log(`\x1b[36m[Controller]\x1b[0m Requesting Sandbox Engine to boot session: ${sessionId}`);
      
      // 3. CHECK EXISTING SESSION: See if this user already has a paused sandbox
      let session = await this.sessionRepo.get(sessionId);
      let targetSandboxId = session?.openSandboxId;
      let endpointUrl = this.openSandboxApiUrl;

      // 4. CREATE SANDBOX IF WE HAVE NONE
      if (!targetSandboxId) {
        const imageTag = (environment as any).imageName;
        console.log(`\x1b[36m[API]\x1b[0m Requesting Sandbox for image: ${imageTag}`);

        // Tell OpenSandbox to boot the Docker image WITH our volumes and workdir
        // --REFACTOR-- We use router now
        const bootData = await this.router.bootContainer({
          imageTag: imageTag,
          volumes: bootVolumes,
          envVars:["WORKDIR=/workspace"]
        });

        targetSandboxId = bootData.sandboxId;

        // Execute Post-Boot Setup (e.g., Git clone strategy)
        if(provisioner)
        {
          try {
            console.log(`\x1b[36m[API]\x1b[0m Running post-boot provisioner...`);
            await provisioner.runPostBoot(targetSandboxId);
          } catch (provisionErr: any) {
            console.error(`\x1b[31m[Provisioner Error]\x1b[0m ${provisionErr.message}`);
            // Note: We log the error but don't crash the session entirely, 
            // allowing the user to manually clone from the terminal if needed.
          }
        }
        
      
        // 5. TRIGGER EVENTS FOR OUR DATABASE TRACKING!
        // The PersistenceLayer daemon listens for this to run sessionRepo.save()
        // Save session locally and trigger Persistence Layer
        const sessionRecord = {
          sessionId: sessionId, 
          openSandboxId: targetSandboxId, 
          envId: envId,
          status: bootData.status,
          createdAt: Date.now()
        };

        this.systemEvents.emit('sandbox:provisioned', {
            ...sessionRecord,
            mountPath: '/workspace'
        });
        
      } else {
        console.log(`\x1b[36m[API]\x1b[0m Resuming existing Sandbox: ${targetSandboxId}`);
        // Fire the status change event so the PersistenceLayer updates the DB to 'active'
        this.systemEvents.emit('sandbox:status_changed', { sessionId, status: 'active' });
      }

      // 6. THE HANDOFF: Give the connection details back to the React frontend
      res.status(200).json({
        message: 'Sandbox provisioned successfully',
        sessionId,
        sandboxId: targetSandboxId,
        endpoint: endpointUrl
      });

    } catch (error: any) {
      console.error('\x1b[31m[SandboxController Error]\x1b[0m', error.message);
      // Now we have the actual error, mad useful ngl
      res.status(500).json({ error: error.message || 'Failed to provision workspace environment' });
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
      
      if (!session || !session.openSandboxId) {
        res.status(404).json({ error: 'Session not found in database' });
        return;
      }

      if (!session.openSandboxId) {
        res.status(400).json({ error: 'Session does not have an active Sandbox attached' });
        return;
      }

      console.log(`\x1b[33m[API]\x1b[0m Pausing Sandbox: ${session.openSandboxId}`);

      // 1. Tell Alibaba's engine to freeze the container
      await this.router.pauseSandbox(session.openSandboxId);

      // 2. FIRE THE EVENT!
      // The PersistenceLayer will hear this and update the DB status to 'paused'
      this.systemEvents.emit('sandbox:paused', sessionId);

      res.status(200).json({ message: 'Session paused successfully' });
    } catch (error: any) {
      console.error('\x1b[31m[SandboxController Error]\x1b[0m', error.message);
      res.status(500).json({ error: error.message || 'Failed to pause session' });
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
      if (!session || !session.openSandboxId) {
        res.status(404).json({ error: 'Session not found or already stopped.' });
        return;
      }

      // 1. Tell the Engine to destroy the Docker container
      await this.router.destroySandbox(session.openSandboxId);

      // 2. Remove from our database by emitting event
  
      // FIX 2: Emit 'sandbox:destroyed' and just pass the string, not an object
      this.systemEvents.emit('sandbox:destroyed', sessionId);

      res.status(200).json({ message: 'Session terminated successfully.' });
    } catch (error: any) {
      console.error('\x1b[31m[SandboxController Error]\x1b[0m Failed to stop session:', error.message);
      res.status(500).json({ error: error.message });
    }
  };
}