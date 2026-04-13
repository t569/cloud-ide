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

  // GET: List all available environments for the frontend dropdown
  router.get('/', async (req: Request, res: Response) => {
    const environments = await envRepo.list();
    res.json(environments);
  });

  // GET: Fetch a specific environment by its ID (string)
  router.get('/:envId', async (req: Request, res: Response) => {
    const { envId } = req.params;

    // THE FIX: Strict Type Guard
    if (!envId || typeof envId !== 'string') {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return;
    }

    try {
      // TypeScript now knows envId is 100% a string
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

  // POST: Create a new custom environment from the frontend builder
   router.post('/', async (req: Request, res: Response) => {
    const newEnv: EnvironmentRecord = req.body;

    let validatedConfigStr: string;

    
    // 1. Validate the Configuration early
    let validatedConfig;
    try {
      const rawConfigString = JSON.stringify(newEnv.builderConfig);

      validatedConfigStr = Validator.parseAndValidate(rawConfigString, {return_a_string: true});
      validatedConfig = Validator.parseAndValidate(rawConfigString);

      // set the env's build config
      newEnv.builderConfig = validatedConfig;


    } catch (err: any) {
      // If validation fails, we return a standard 400 JSON response and stop execution
      res.status(400).json({ 
        error: 'Invalid Environment Configuration', 
        details: err.message 
      });
      return;
    }

    // 2. Setup HTTP Chunked Streaming
    // From this point on, we do NOT use res.json(). We are streaming plain text directly to the frontend terminal!
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      // MOD:

      // 3. Define the target image tag for the local Docker daemon
      const finalImageName = `cloud-ide-${newEnv.id}:latest`;


      // 4. Execute the build pipeline and wrap the Event Emitter in a Promise
      await new Promise<void>((resolve, reject) => {
        // streamBuild internally calls DockerGeneratorService.generateDockerfile()
        const logStream = ExecutorService.streamBuild(validatedConfigStr, finalImageName);

        // Stream standard logs directly to the frontend chunked response
        logStream.on('data', (chunk: string) => {
          res.write(chunk);
        });

        // Handle successful completion
        logStream.on('success', (msg: string) => {
          res.write(`\r\n\x1b[1;32m[Docker]\x1b[0m ${msg}\r\n`);
          resolve(); 
        });

        // Handle fatal build errors
        logStream.on('error', (errMsg: string) => {
          reject(new Error(errMsg)); // Sends to the outer catch block
        });
      })



      // 5. Finalize the Database Record
      newEnv.imageName = finalImageName; // CRITICAL: Link the generated Docker tag so OpenSandbox can find it!
      newEnv.createdAt = Date.now();

      // Safely write to ROM
      await envRepo.save(newEnv);
      
      // 6. Close the HTTP stream successfully
      res.end(`\r\n\x1b[1;32m[System]\x1b[0m Environment '${newEnv.imageName}' successfully created and saved to database.\r\n`);

    } catch (err: any) {
      // If the Docker build fails, we catch it here and stream the final error message
      res.end(`\r\n\x1b[1;31m[System Error]\x1b[0m Build aborted: ${err.message}\r\n`);
    }
  });

  // DELETE: delete an environment
  router.delete('/:envId', async (req: Request, res: Response) => {
    const { envId } = req.params;

    // GUARD FOR TYPE CHECKING OF ENV ID NAME
    if (!envId || typeof envId !== 'string') {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return;
    }

    // THE FALL CASE CHECK: Look for linked process blocks
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
