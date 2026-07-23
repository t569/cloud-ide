// Workspace management plane, mounted at /api/v1/workspaces (workspace-entity.md).
//
// USER-scoped, not sandbox-scoped: a workspace belongs to a person, so there is no
// :sandboxId to own here — the controller owner-gates each :id by req.userId directly
// (attachUser runs globally, before this). Same shape as the git credential routes.
import { Router, raw } from 'express';
import { WorkspaceController } from '../controllers/WorkspaceController';

/** Upload cap. The archive is buffered whole (unzip.ts), so this is also a memory bound. */
const MAX_ARCHIVE = '100mb';

export function createWorkspaceRouter(controller: WorkspaceController): Router {
  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.delete('/:id', controller.remove);
  // Raw body on THIS route only — the global express.json() ignores a non-JSON
  // content-type, so the bytes arrive here untouched. `type: '*/*'` because browsers
  // label a .zip inconsistently (application/zip vs application/x-zip-compressed).
  router.post('/:id/archive', raw({ type: '*/*', limit: MAX_ARCHIVE }), controller.uploadArchive);
  router.put('/:id/credential', controller.setCredential);
  router.delete('/:id/credential', controller.clearCredential);
  return router;
}
