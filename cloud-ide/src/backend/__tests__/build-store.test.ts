// A power loss mid-build leaves `builds.json` holding a 'building' record. On the
// next boot the store must reconcile it to 'failed' -- but it must NOT do so at the
// expense of a build accepted while the (async) load was still running. begin() is
// sync; load() is not. That gap made a live build report the PREVIOUS run's
// "Interrupted by a server restart" while docker built on in the background.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IBuildStore } from '../src/services/builder/BuildStore';
import { JsonBuildStore, InMemoryBuildStore, BuildConflictError } from '../src/services/builder/BuildStore';

let dir: string;
const crashed = { records: [{ buildId: 'b-old', envId: 'my-env', status: 'building', startedAt: 1 }] };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'builds-'));
});
afterEach(async () => {
  // changed() fires an async persist we don't await; on Windows the rename still
  // holds the file when the test ends. Retry rather than reach into the write chain.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const seed = (data: unknown) => fs.writeFile(path.join(dir, 'builds.json'), JSON.stringify(data));

it('reconciles a build interrupted by a crash to failed', async () => {
  await seed(crashed);
  const store = new JsonBuildStore(dir);
  await store.ready;

  expect(store.get('my-env')).toMatchObject({
    buildId: 'b-old',
    status: 'failed',
    error: 'Interrupted by a server restart',
  });
});

it('a rebuild after that crash is allowed (the conflict lock is released)', async () => {
  await seed(crashed);
  const store = new JsonBuildStore(dir);
  await store.ready;

  expect(() => store.begin('my-env')).not.toThrow();
  expect(store.get('my-env')?.status).toBe('queued');
});

it('a build begun before hydration finishes survives it', async () => {
  await seed(crashed);
  const store = new JsonBuildStore(dir);

  store.begin('my-env'); // server was listening; user clicked Build mid-load
  const liveId = store.get('my-env')!.buildId;

  await store.ready;

  const state = store.get('my-env')!;
  expect(state.buildId).toBe(liveId);          // not the crashed record
  expect(state.status).toBe('queued');         // not 'failed'
  expect(state.error).toBeUndefined();

  // ...and it still finishes normally, rather than no-op'ing on a vanished state.
  store.finish('my-env', true, { imageTag: 'img:1' });
  expect(store.get('my-env')).toMatchObject({ status: 'succeeded', imageTag: 'img:1' });

  // The crashed record is still reconciled, and kept in history.
  const history = store.history('my-env');
  expect(history.map((r) => r.buildId)).toEqual([liveId, 'b-old']);
  expect(history[1].status).toBe('failed');
});

it('the live build still holds its per-env conflict lock across hydration', async () => {
  await seed(crashed);
  const store = new JsonBuildStore(dir);
  store.begin('my-env');
  await store.ready;

  expect(() => store.begin('my-env')).toThrow(BuildConflictError);
});

// server.ts gates listen() on `store.ready ?? Promise.resolve()`, so a volatile
// store must simply not have one.
it('volatile stores expose no ready and need no hydration', () => {
  const store: IBuildStore = new InMemoryBuildStore();
  expect(store.ready).toBeUndefined();
});
