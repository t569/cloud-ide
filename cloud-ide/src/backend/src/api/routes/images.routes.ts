// Server-side proxy to Docker Hub search — the browser can't hit hub.docker.com
// directly (CORS). Lets the env architect pick a real base image + tag instead of
// hand-typing one that fails deep in `docker build` (e.g. python:22.04).
import { Router, Request, Response } from 'express';

// Search uses the v3 catalog API. The old `/v2/search/repositories/` endpoint was
// deprecated by Docker Hub and now 404s, which surfaced as a 502 on every search. Tags
// still come from the stable `/v2/repositories/.../tags/` API.
const HUB_SEARCH = 'https://hub.docker.com/api/search/v3/catalog/search';
const HUB_V2 = 'https://hub.docker.com/v2';
const TIMEOUT_MS = 8000;

async function hubGet(url: string): Promise<any> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Docker Hub responded ${r.status}`);
  return r.json();
}

// A v3 catalog entry -> our stable ImageResult shape. Defensive about field names: the
// repo identifier and the official flag have shifted across Hub revisions, so read several
// and normalise. `library/` is the official-images namespace; the tags endpoint treats a
// bare name as living there, so strip the prefix to keep `name` a valid tags query.
export function toResult(x: any): { name: string; description?: string; official: boolean; stars: number } {
  const raw = String(x.slug ?? x.name ?? x.id ?? '');
  const official =
    x.filter_type === 'official' ||
    x.badge === 'official' ||
    raw.startsWith('library/') ||
    /docker official/i.test(x.publisher?.name ?? '');
  return {
    name: raw.replace(/^library\//, ''),
    description: x.short_description,
    official,
    stars: Number(x.star_count ?? 0),
  };
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
      const data = await hubGet(`${HUB_SEARCH}?query=${encodeURIComponent(q)}&size=10`);
      const results = (data.results ?? [])
        .filter((x: any) => !x.type || x.type === 'image') // the catalog can include extensions/plugins
        .map(toResult)
        .filter((r: { name: string }) => r.name)
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
        `${HUB_V2}/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags/?page_size=30&ordering=last_updated`,
      );
      res.json({ tags: (data.results ?? []).map((t: any) => t.name) });
    } catch (e: any) {
      res.status(502).json({ error: `Docker Hub tags failed: ${e.message}` });
    }
  });

  return router;
}
