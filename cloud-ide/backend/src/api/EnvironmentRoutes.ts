// backend/src/api/EnvironmentRoutes.ts
import { Router, Request, Response } from 'express';
import { IEnvironmentRepository } from '../database/interfaces/IEnvironmentRepository';
import { ISessionRepository } from '../database/interfaces/ISessionRepository';

// Import our Core Tools
import { ConfigParser } from '@cloud-ide/shared';
import { DockerBuilder } from 'src/services/DockerBuilder'; // Adjust path if needed
import { DockerGenerator } from '@cloud-ide/shared'; // The class that turns Config into a Dockerfile string

// Import Models
import { EnvironmentRecord } from '../database/models';

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
    
    // 1. Validate the Configuration early
    let validatedConfig;
    try {
      const rawConfigString = JSON.stringify(newEnv.builderConfig);
      validatedConfig = ConfigParser.parseAndValidate(rawConfigString);
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
      // 3. Generate the Dockerfile string from the validated config
      const dockerfileContent = DockerGenerator.generate(validatedConfig);

      // 4. Initialize the Builder and pass the Express Response object (`res`)
      const builder = new DockerBuilder(newEnv.id, dockerfileContent);
      
      // This will take time, but the frontend will see the logs streaming in real-time
      const finalImageName = await builder.buildAndStreamLogs(res);

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