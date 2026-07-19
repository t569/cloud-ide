// Workspace management plane, mounted at /api/v1/workspaces (workspace-entity.md).
//
// USER-scoped, not sandbox-scoped: a workspace belongs to a person, so there is no
// :sandboxId to own here — the controller owner-gates each :id by req.userId directly
// (attachUser runs globally, before this). Same shape as the git credential routes.
import { Router } from 'express';
import { WorkspaceController } from '../controllers/WorkspaceController';

export function createWorkspaceRouter(controller: WorkspaceController): Router {
  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.delete('/:id', controller.remove);
  router.put('/:id/credential', controller.setCredential);
  router.delete('/:id/credential', controller.clearCredential);
  return router;
}
