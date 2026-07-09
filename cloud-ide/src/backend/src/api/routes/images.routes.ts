// Server-side proxy to Docker Hub search — the browser can't hit hub.docker.com
// directly (CORS). Lets the env architect pick a real base image + tag instead of
// hand-typing one that fails deep in `docker build` (e.g. python:22.04).
import { Router, Request, Response } from 'express';

const HUB = 'https://hub.docker.com/v2';
const TIMEOUT_MS = 8000;

async function hubGet(path: string): Promise<any> {
  const r = await fetch(`${HUB}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Docker Hub responded ${r.status}`);
  return r.json();
}

export function createImageRouter(): Router {
  const router = Router();

  // GET /api/images/search?q=python  -> matching repositories (official first)
  router.get('/search', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ results: [] });
      return;
    }
    try {
      // encodeURIComponent: q is user input crossing into an outbound URL.
      const data = await hubGet(`/search/repositories/?query=${encodeURIComponent(q)}&page_size=10`);
      const results = (data.results ?? [])
        .map((x: any) => ({
          name: x.repo_name,
          description: x.short_description,
          official: x.is_official,
          stars: x.star_count,
        }))
        .sort((a: any, b: any) => Number(b.official) - Number(a.official) || b.stars - a.stars);
      res.json({ results });
    } catch (e: any) {
      res.status(502).json({ error: `Docker Hub search failed: ${e.message}` });
    }
  });

  // GET /api/images/tags?repo=python  -> tag names, newest first
  router.get('/tags', async (req: Request, res: Response) => {
    const repo = String(req.query.repo ?? '').trim();
    if (!repo) {
      res.json({ tags: [] });
      return;
    }
    // Bare names are official images -> the "library" namespace on the Hub API.
    const [namespace, name] = repo.includes('/') ? repo.split('/') : ['library', repo];
    try {
      const data = await hubGet(
        `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags/?page_size=30&ordering=last_updated`,
      );
      res.json({ tags: (data.results ?? []).map((t: any) => t.name) });
    } catch (e: any) {
      res.status(502).json({ error: `Docker Hub tags failed: ${e.message}` });
    }
  });

  return router;
}
