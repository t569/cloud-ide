// backend/src/api/routes/environment.routes.ts
import { Router, Request, Response } from 'express';
import { IEnvironmentRepository } from '../../database/interfaces/IEnvironmentRepository';
import { ISessionRepository } from '../../database/interfaces/ISessionRepository';

// Core tools — naming validity lives entirely in @cloud-ide/shared.
import { Validator, resolveNewNaming, validateName, toImageName } from '@cloud-ide/shared';
import { BuildService, BuildConflictError } from '../../services/builder';

// Models
import { EnvironmentRecord } from '../../database/models';

export function createEnvironmentRouter(
  envRepo: IEnvironmentRepository,
  sessionRepo: ISessionRepository,
  buildService: BuildService,
) {
  const router = Router();

  // :envId is typed string | string[] by Express; narrow it once, 400 otherwise.
  const readId = (req: Request, res: Response): string | null => {
    const value = req.params.envId;
    if (typeof value !== 'string' || value.length === 0) {
      res.status(400).json({ error: 'Invalid environment ID parameter' });
      return null;
    }
    return value;
  };

  // ==========================================================================
  // GET /            List all environments
  // ==========================================================================
  router.get('/', async (_req: Request, res: Response) => {
    res.json(await envRepo.list());
  });

  // ==========================================================================
  // GET /statuses    Current build status of every env (live-poll, one request)
  // Registered before '/:envId' so the literal path wins.
  // ==========================================================================
  router.get('/statuses', (_req: Request, res: Response) => {
    res.json(buildService.allStatuses());
  });

  // ==========================================================================
  // GET /:envId      Fetch one environment
  // ==========================================================================
  router.get('/:envId', async (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;
    try {
      const environment = await envRepo.get(envId);
      if (!environment) {
        res.status(404).json({ error: `Environment '${envId}' not found.` });
        return;
      }
      res.status(200).json(environment);
    } catch {
      res.status(500).json({ error: 'Failed to retrieve environment' });
    }
  });

  // ==========================================================================
  // GET /:envId/status   Current build status (for the UI)
  // ==========================================================================
  router.get('/:envId/status', (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;
    res.json(buildService.status(envId) ?? { envId, status: 'idle' });
  });

  // ==========================================================================
  // GET /:envId/builds   Persistent build history for one environment
  // ==========================================================================
  router.get('/:envId/builds', (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;
    res.json(buildService.history(envId));
  });

  // ==========================================================================
  // POST /           Create a NEW environment (id minted by us)
  // ==========================================================================
  router.post('/', async (req: Request, res: Response) => {
    try {
      const incoming = req.body?.builderConfig ?? req.body ?? {};

      // System owns identity; use the given name if valid, else name it ourselves.
      const { id, name } = resolveNewNaming(incoming.name);

      const validated = Validator.parseAndValidate(JSON.stringify({ ...incoming, id, name }));
      // Guarantee the stored config agrees with the record identity.
      validated.id = id;
      validated.name = name;

      const record: EnvironmentRecord = {
        id,
        imageName: '',
        builderConfig: validated,
        createdAt: Date.now(),
        isRepoSpecific: incoming.isRepoSpecific ?? false,
        targetRepo: incoming.targetRepo,
        trackedTools: incoming.trackedTools ?? [],
      };

      await envRepo.save(record);
      res.status(201).json({ message: 'Environment created.', environment: record });
    } catch (err: any) {
      res.status(400).json({ error: 'Invalid environment configuration', details: err.message });
    }
  });

  // ==========================================================================
  // PUT /:envId      Update an EXISTING environment (identity is immutable)
  // ==========================================================================
  router.put('/:envId', async (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;
    try {
      const existing = await envRepo.get(envId);
      if (!existing) {
        res.status(404).json({ error: `Environment '${envId}' not found.` });
        return;
      }

      const incoming = req.body?.builderConfig ?? req.body ?? {};

      // Keep the current name unless a valid new one is supplied (no auto-rename).
      let name = existing.builderConfig?.name ?? existing.id;
      if (incoming.name != null && String(incoming.name).trim() !== '') {
        const check = validateName(incoming.name);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        name = check.value;
      }

      const validated = Validator.parseAndValidate(
        JSON.stringify({ ...incoming, id: existing.id, name }),
      );
      validated.id = existing.id;
      validated.name = name;

      const updated: EnvironmentRecord = { ...existing, builderConfig: validated };
      await envRepo.save(updated);
      res.status(200).json({ message: 'Environment updated.', environment: updated });
    } catch (err: any) {
      res.status(400).json({ error: 'Invalid environment configuration', details: err.message });
    }
  });

  // ==========================================================================
  // POST /:envId/build   Build the image (streaming logs)
  // ==========================================================================
  router.post('/:envId/build', async (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;
    const environment = await envRepo.get(envId);
    if (!environment) {
      res.status(404).json({ error: `Environment '${envId}' not found.` });
      return;
    }

    let proc;
    try {
      proc = buildService.start(environment);
    } catch (err) {
      if (err instanceof BuildConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to start build', details: (err as Error).message });
      return;
    }

    // Stream logs as plain text; Express handles chunked transfer.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    proc.on('data', (chunk: string) => res.write(chunk));

    proc.on('succeeded', async (message: string) => {
      environment.imageName = toImageName(environment.id);
      await envRepo.save(environment);
      res.end(`\r\n\x1b[1;32m[System]\x1b[0m ${message}\r\n`);
    });

    proc.on('failed', (message: string) => {
      res.end(`\r\n\x1b[1;31m[System Error]\x1b[0m ${message}\r\n`);
    });

    // If the client disconnects mid-build, stop the build.
    req.on('close', () => proc?.cancel());
  });

  // ==========================================================================
  // DELETE /:envId   Remove an environment (blocked while sessions use it)
  // ==========================================================================
  router.delete('/:envId', async (req: Request, res: Response) => {
    const envId = readId(req, res);
    if (!envId) return;

    const activeSessions = await sessionRepo.getSessionsByEnvId(envId);
    if (activeSessions.length > 0) {
      res.status(409).json({
        error: `Cannot delete environment. ${activeSessions.length} sessions are currently using it.`,
      });
      return;
    }

    await envRepo.delete(envId);
    res.json({ message: `Environment ${envId} safely deleted.` });
  });

  return router;
}
