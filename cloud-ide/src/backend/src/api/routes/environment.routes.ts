// backend/src/api/EnvironmentRoutes.ts
import { Router, Request, Response } from 'express';
import { IEnvironmentRepository } from '../../database/interfaces/IEnvironmentRepository';
import { ISessionRepository } from '../../database/interfaces/ISessionRepository';

// Import our Core Tools
import { Validator } from '@cloud-ide/shared';
import { DockerGeneratorService } from '../../services/builder';
import { ExecutorService } from '../../services/builder';

// Import Models
import { EnvironmentRecord } from '../../database/models';

export function createEnvironmentRouter(envRepo: IEnvironmentRepository, sessionRepo: ISessionRepository) {
  const router = Router();

  // ============================================================================
  // GET: List all environments
  // ============================================================================
  router.get('/', async (req: Request, res: Response) => {
    const environments = await envRepo.list();
    res.json(environments);
  });


  // ============================================================================
  // GET: Fetch specific environment
  // ============================================================================
  router.get('/:envId', async (req: Request, res: Response) => {
    const { envId } = req.params;

    if (!envId || typeof envId !== 'string') {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return;
    }

    try {
      const environment = await envRepo.get(envId);
      if (!environment) {
        res.status(404).json({ error: `Environment '${envId}' not found.` });
        return;
      }
      res.status(200).json(environment);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to retrieve environment' });
    }
  });


 // ============================================================================
  // POST: Create or Update an Environment (SAVE ONLY - NO BUILD)
  // ============================================================================
  router.post('/', async (req: Request, res: Response) => {
    try {
      const rawPayload = req.body;
      const builderConfig = rawPayload.builderConfig || rawPayload; 
      
      // 1. Force the ID to be docker-safe (Fixes the space issue)
      builderConfig.id = (builderConfig.id || `env-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      
      if (!builderConfig.name || builderConfig.name.trim() === '') {
        builderConfig.name = builderConfig.id;
      }

      // 2. Validate the Configuration
      const rawConfigString = JSON.stringify(builderConfig);
      const validatedConfig = Validator.parseAndValidate(rawConfigString);

      // 3. Format the Environment Record
      const newEnv: EnvironmentRecord = {
        id: builderConfig.id,
        imageName: '', 
        builderConfig: validatedConfig,
        createdAt: Date.now(),
        isRepoSpecific: builderConfig.isRepoSpecific || false,
        targetRepo: builderConfig.targetRepo,
        trackedTools: builderConfig.trackedTools || []
      };

      // 4. Save to Database
      await envRepo.save(newEnv);
      res.status(200).json({ message: 'Environment saved successfully.', environment: newEnv });

    } catch (err: any) {
      console.error("[Schema Validation Error]:", err.message);
      res.status(400).json({ error: 'Invalid Environment Configuration', details: err.message });
    }
  });

  // ============================================================================
  // POST: Execute the Build Pipeline (STREAMING LOGS)
  // ============================================================================
  router.post('/:envId/build', async (req: Request, res: Response) => {
    const { envId } = req.params;

    if (!envId || typeof envId !== 'string') {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return;
    }

    try {
      // 1. Fetch the saved JSON schema from the DB
      const environment = await envRepo.get(envId);
      if (!environment) {
        res.status(404).json({ error: `Environment '${envId}' not found.` });
        return;
      }

      // 2. Validate and get stringified config for the Executor
      const rawConfigString = JSON.stringify(environment.builderConfig);
      const validatedConfigStr = Validator.parseAndValidate(rawConfigString, { return_a_string: true });

      // 3. Setup HTTP Chunked Streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      try {
        // Define the target image tag
        const finalImageName = `cloud-ide-${environment.id}:latest`;

        // 4. Execute the build pipeline and wrap the Event Emitter in a Promise
        await new Promise<void>((resolve, reject) => {
          const logStream = ExecutorService.streamBuild(validatedConfigStr, finalImageName);

          logStream.on('data', (chunk: string) => {
            res.write(chunk);
          });

          logStream.on('success', (msg: string) => {
            res.write(`\r\n\x1b[1;32m[Docker]\x1b[0m ${msg}\r\n`);
            resolve(); 
          });

          logStream.on('error', (errMsg: string) => {
            reject(new Error(errMsg)); 
          });
        });

        // 5. Finalize the Database Record
        environment.imageName = finalImageName;
        // Using an optional 'updatedAt' or 'lastBuilt' if your model supports it
        await envRepo.save(environment);
        
        res.end(`\r\n\x1b[1;32m[System]\x1b[0m Environment '${environment.imageName}' successfully built and registered.\r\n`);

      } catch (err: any) {
        res.end(`\r\n\x1b[1;31m[System Error]\x1b[0m Build aborted: ${err.message}\r\n`);
      }

    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to initiate build pipeline.' });
      }
    }
  });



  // ============================================================================
  // DELETE: Remove an environment
  // ============================================================================
  router.delete('/:envId', async (req: Request, res: Response) => {
    const { envId } = req.params;

    if (!envId || typeof envId !== 'string') {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return;
    }

    // Protection logic maintained
    const activeSessions = await sessionRepo.getSessionsByEnvId(envId);
    
    if (activeSessions.length > 0) {
      res.status(409).json({ 
        error: `Cannot delete environment. ${activeSessions.length} sessions are currently using it.` 
      });
      return;
    }

    await envRepo.delete(envId);
    res.json({ message: `Environment ${envId} safely deleted.` });
  });

  return router;
}