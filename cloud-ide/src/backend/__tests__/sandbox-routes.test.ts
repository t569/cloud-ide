// The ownership guard is structural: `router.use('/:sandboxId', ...)` must cover
// every sandbox-scoped route, including ones nested two segments deep, while leaving
// the collection routes (POST /, GET /) open. That is a claim about Express's
// matching, not about our code, so it gets exercised against a real router over real
// HTTP. Asserting it by reading the source is how the previous per-route wiring
// managed to ship `exec`/`pause`/`resume`/`destroy` with no ownership check at all.
//
// ponytail: no supertest. `http.createServer` + global fetch is a few lines.
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createSandboxRouter } from '../src/api/SandboxRoutes';
import type { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const ALICE = 'user-alice';

// alice owns 'mine'; bob owns 'theirs'.
const REPO = {
  get: async (id: string): Promise<SandboxRecord | null> =>
    id === 'mine'
      ? ({ sandboxId: 'mine', userId: ALICE } as SandboxRecord)
      : id === 'theirs'
        ? ({ sandboxId: 'theirs', userId: 'user-bob' } as SandboxRecord)
        : null,
} as any;

// Every handler just says which one it was, so a 200 proves the guard let it through.
const CONTROLLER = new Proxy(
  {},
  { get: (_t, name) => (_req: any, res: any) => res.json({ handler: String(name) }) },
) as any;

let baseUrl: string;
let server: ReturnType<express.Express['listen']>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand in for attachUser: the guard only reads req.userId.
  app.use((req, _res, next) => {
    req.userId = ALICE;
    next();
  });
  app.use('/api/v1/sandboxes', createSandboxRouter(CONTROLLER, REPO));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/sandboxes`;
});

afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));

const call = (method: string, path: string) =>
  fetch(`${baseUrl}${path}`, { method }).then((r) => r.status);

describe('collection routes are not owner-gated (there is no :sandboxId to own)', () => {
  it('POST / creates ownership rather than checking it', async () => {
    expect(await call('POST', '/')).toBe(200);
  });

  it('GET / filters by identity instead', async () => {
    expect(await call('GET', '/')).toBe(200);
  });
});

describe('every sandbox-scoped route is owner-gated by the router, not by memory', () => {
  // Each of these was individually decorated with `ownsSandbox` in server.ts before.
  const routes: Array<[string, string]> = [
    ['GET', ''],
    ['POST', '/exec'],
    ['POST', '/pause'],
    ['POST', '/resume'],
    ['DELETE', ''],
    ['POST', '/volumes'],
    ['DELETE', '/volumes/some-volume'],
  ];

  it.each(routes)("%s /:sandboxId%s → 200 for the owner", async (method, suffix) => {
    expect(await call(method, `/mine${suffix}`)).toBe(200);
  });

  it.each(routes)("%s /:sandboxId%s → 404 for a non-owner", async (method, suffix) => {
    expect(await call(method, `/theirs${suffix}`)).toBe(404);
  });

  it.each(routes)("%s /:sandboxId%s → 404 for an unknown sandbox", async (method, suffix) => {
    expect(await call(method, `/no-such-sandbox${suffix}`)).toBe(404);
  });
});
