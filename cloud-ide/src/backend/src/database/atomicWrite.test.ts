// ensureJsonFile's contract is "never rejects", and that is load-bearing rather than
// cosmetic: every JSON repository stores this promise as `ready` and awaits it on every
// read, so one rejection poisons the repository for the life of the process.
//
// The real-world trigger is a rename over a file another process holds open (EPERM on
// Windows), reproduced at ~1 in 1600 constructions under parallel load. A race that rare
// is useless as a test, so these force the failure deterministically instead.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureJsonFile, writeJsonAtomic } from './atomicWrite';

describe('atomicWrite', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));

  it('writes JSON that reads back exactly', async () => {
    const file = path.join(dir, 'db.json');
    await writeJsonAtomic(file, { a: 1, nested: { b: 'two' } });
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ a: 1, nested: { b: 'two' } });
  });

  it('leaves no temp file behind on success', async () => {
    await writeJsonAtomic(path.join(dir, 'db.json'), {});
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('creates the store when it is missing', async () => {
    const file = path.join(dir, 'nested', 'db.json');
    await ensureJsonFile(file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({});
  });

  it('leaves an existing store untouched', async () => {
    const file = path.join(dir, 'db.json');
    await writeJsonAtomic(file, { keep: true });
    await ensureJsonFile(file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ keep: true });
  });

  // THE regression. A parent that is a FILE makes mkdir fail with ENOTDIR, so the
  // underlying write genuinely throws — the same shape as the transient EPERM seen in the
  // wild, without needing to win a race.
  it('NEVER rejects when the store cannot be created', async () => {
    const notADirectory = path.join(dir, 'blocker');
    await fs.writeFile(notADirectory, 'i am a file');
    const impossible = path.join(notADirectory, 'sub', 'db.json');

    // The bare write fails, proving the scenario is real...
    await expect(writeJsonAtomic(impossible, {})).rejects.toThrow();
    // ...and ensureJsonFile swallows it, because a missing store is a valid state while a
    // permanently rejected `ready` is not.
    await expect(ensureJsonFile(impossible)).resolves.toBeUndefined();
  });
});
