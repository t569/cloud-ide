// Sandbox control plane, mounted at /api/v1/sandboxes.
//
// The ownership guard is STRUCTURAL, not per-route: `router.use('/:sandboxId', ...)`
// covers every sandbox-scoped route that exists now and every one added later. The
// previous wiring listed the guard on each route in server.ts, which is fail-OPEN —
// a new route is unprotected until someone remembers. That is not hypothetical: the
// whole `/api/v1/sandboxes/:sandboxId` family (exec, pause, resume, destroy, volumes)
// once shipped with CSRF only and no ownership check at all.
//
// Same shape as createFileSystemRouter / createPreviewRouter — sandbox routes were
// the last ones still hand-mounted on `app`.
//
// NOT here: DELETE /api/v1/admin/sandboxes/:sandboxId. Admin force-destroy operates
// on OTHER users' sandboxes by design, so it must never inherit this guard. It lives
// on its own path behind requireAdmin.
import { Router } from 'express';
import { SandboxController } from '../controllers/SandboxController';
import { ISandboxRepository } from '../database/interfaces';
import { requireSandboxOwnership } from './middleware/security';

export function createSandboxRouter(
  controller: SandboxController,
  sandboxRepo: ISandboxRepository,
): Router {
  const router = Router();

  // Collection routes: no :sandboxId to own. `create` establishes ownership rather
  // than checking it; `list` filters by the caller's identity instead.
  router.post('/', controller.createSandbox);
  router.get('/', controller.listSandboxes);

  // Driver capabilities (pty/exec) — global, not sandbox-scoped, so it sits above the
  // ownership guard. The terminal UI reads `pty` to pick its transport (WS PTY vs SSE).
  router.get('/capabilities', controller.getCapabilities);

  // IDOR: everything below is scoped to a sandbox the caller must own. CSRF does not
  // cover this — it stops another SITE forging a request from this browser, not this
  // browser asking for a sandbox it does not own. 404 (not 403) so ids can't be enumerated.
  router.use('/:sandboxId', requireSandboxOwnership(sandboxRepo));

  router.get('/:sandboxId', controller.getSandboxStatus);
  router.get('/:sandboxId/network', controller.getSandboxNetwork);
  router.get('/:sandboxId/preview-token', controller.getPreviewToken);
  router.get('/:sandboxId/sessions', controller.listSessions);
  router.get('/:sandboxId/activity', controller.listActivity);
  router.get('/:sandboxId/logs', controller.streamLogs);
  // What the user installed beyond the base image — the input to env-promotion.
  router.get('/:sandboxId/drift', controller.getToolDrift);
  router.post('/:sandboxId/exec', controller.execCommand);
  router.post('/:sandboxId/pause', controller.pauseSandbox);
  router.post('/:sandboxId/resume', controller.resumeSandbox);
  // Replace the container, keep the worktree — applies boot-time changes (egress).
  router.post('/:sandboxId/restart', controller.restartSandbox);
  router.delete('/:sandboxId', controller.destroySandbox);
  router.post('/:sandboxId/volumes', controller.attachVolume);
  router.delete('/:sandboxId/volumes/:volumeName', controller.detachVolume);

  return router;
}
