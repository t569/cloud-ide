// backend/src/api/EnvironmentRoutes.ts
import { Router } from 'express';
import { IEnvironmentRepository } from '../database/IEnvironmentRepository';
import { ISessionRepository } from '../database/ISessionRepository';

export function createEnvironmentRouter(envRepo: IEnvironmentRepository, sessionRepo: ISessionRepository) {
  const router = Router();

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