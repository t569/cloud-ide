// src/backend/api/SessionRoutes.ts

/* This file handles the routing
* the sessions are routed here using the api
* it is then registered on our server
* To look at our server check: src/server.ts
*/ 
import { Router } from 'express';
import { SessionManager } from '../core/SessionManager';
// We will also import DatabaseService and WorkspaceManager here later

export function createSessionRouter(sessionManager: SessionManager) {
  const router = Router();

  // POST /api/session/:id/stop
  router.post('/:id/stop', async (req, res) => {
    const { id } = req.params;
    
    // 1. Tell OS to halt the container
    sessionManager.handleDecouple(id, 'STOP');
    
    // 2. TODO: Tell DB to mark session as "sleeping"
    // await db.updateSessionState(id, 'SLEEPING');

    res.json({ message: `Session ${id} successfully stopped.` });
  });

  // DELETE /api/session/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    
    // 1. Tell OS to assassinate the container
    sessionManager.handleDecouple(id, 'DESTROY');
    
    // 2. TODO: Tell WorkspaceManager to wipe the hard drive folder
    // await workspaceManager.deleteWorkspace(id);
    
    // 3. TODO: Tell DB to permanently delete the session record
    // await db.deleteSession(id);

    res.json({ message: `Session ${id} destroyed and purged.` });
  });

  return router;
}