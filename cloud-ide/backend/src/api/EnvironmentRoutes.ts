// backend/src/api/EnvironmentRoutes.ts
import { Router } from 'express';
import { IEnvironmentRepository } from '../database/IEnvironmentRepository';
import { ISessionRepository } from '../database/ISessionRepository';

// this is for frontend to send environments we want to build
import { EnvironmentRecord } from 'src/database/models';
import { ConfigParser } from '@cloud-ide/shared';

export function createEnvironmentRouter(envRepo: IEnvironmentRepository, sessionRepo: ISessionRepository) {
  const router = Router();


  // GET: List all available environments for the frontend dropdown
  router.get('/', async (req, res) => {
    const environments = await envRepo.list();
    res.json(environments);
  });

  // POST: Create a new custom environment from the frontend builder
  router.post('/', async (req, res) => {
    const newEnv: EnvironmentRecord = req.body;
    
    // Add validation here later to ensure newEnv.config matches builder.ts
    // turn newEnv.config to a raw string
    // call parseAndValidate or return error that the json cannot be parsed and validated
    newEnv.createdAt = Date.now();
    
    await envRepo.save(newEnv);
    res.status(201).json({ message: 'Environment created', environment: newEnv });
  });

  // DELETE: delete an environment
  router.delete('/:envId', async (req, res) => {
    const { envId } = req.params;

    // THE FALL CASE CHECK: Look for linked process blocks
    const activeSessions = await sessionRepo.getSessionsByEnvId(envId);
    
    if (activeSessions.length > 0) {
      return res.status(409).json({ 
        error: `Cannot delete environment. ${activeSessions.length} sessions are currently using it.` 
      });
    }

    await envRepo.delete(envId);
    res.json({ message: `Environment ${envId} safely deleted.` });
  });

  return router;
}