// src/backend/api/SessionRoutes.ts

/* This file handles the routing
* the sessions are routed here using the api
* it is then registered on our server
* To look at our server check: src/server.ts
*/ 

// TODO; 22, 35, 38
import { Router } from 'express';
import { SessionManager } from '../core/SessionManager';
// We will also import DatabaseService and WorkspaceManager here later

export function createSessionRouter(sessionManager: SessionManager) {
  const router = Router();
  // NOTE: all handleDecouple() calls:
  // 1. Remove the session from the active session map
  // 2. Change session state in the database


  // POST /api/session/:id/stop
  router.post('/:id/stop', async (req, res) => {
    const { id } = req.params;
    
    // 1. Tell OS to halt the container
    // database auto tracks with event listener daemon see src/core/SessionManager.ts and src/database/PersistenceLayer.ts
    
    // in this case it updates the database to say that the session is sleeping
    sessionManager.handleDecouple(id, 'STOP');
    

    res.json({ message: `Session ${id} successfully stopped.` });
  });

  // DELETE /api/session/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    
    // 1. Tell OS to assassinate the container
    // database auto tracks with event listener daemon see src/core/SessionManager.ts and src/database/PersistenceLayer.ts

    // in this case it tells the database to delete the session
    sessionManager.handleDecouple(id, 'DESTROY');
    
    res.json({ message: `Session ${id} destroyed and purged.` });
  });

  return router;
}