// The fs adapter, exercised by REAL isomorphic-git. Asserting the adapter's own methods in
// isolation would prove very little — what matters is whether a git library that branches on
// errno codes and reads binary objects can actually drive it. So these tests run init / add
// / commit / log / statusMatrix for real, against the in-memory OPFS fake.
import { describe, it, expect, beforeEach } from 'vitest';
import git from 'isomorphic-git';
import { OpfsFs } from './OpfsFs';
import { fakeOpfsRoot } from './fakeOpfs';

const AUTHOR = { name: 'Cloud IDE', email: 'noreply@cloud-ide' };
const DIR = '/workspace';

describe('OpfsFs as isomorphic-git backing store', () => {
  let fs: OpfsFs;

  beforeEach(async () => {
    const root = fakeOpfsRoot();
    fs = new OpfsFs('wsp-1', async () => root);
    await fs.mkdir(DIR);
  });

  it('behaves like node fs where git depends on it', async () => {
    await fs.writeFile('/workspace/a.txt', 'hello');
    expect(await fs.readFile('/workspace/a.txt', 'utf8')).toBe('hello');
    // Binary round-trip: git objects are zlib-deflated bytes, not text.
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await fs.writeFile('/workspace/b.bin', bytes);
    expect(await fs.readFile('/workspace/b.bin')).toEqual(bytes);
    expect((await fs.stat('/workspace/a.txt')).isFile()).toBe(true);
    expect((await fs.stat('/workspace')).isDirectory()).toBe(true);
  });

  it('reports the errno codes git branches on', async () => {
    // These two are load-bearing: isomorphic-git recovers from ENOENT by creating parents
    // and from EEXIST by carrying on. Plain Errors here look like corruption higher up.
    await expect(fs.stat('/workspace/nope.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile('/workspace/nope.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.mkdir('/workspace')).rejects.toMatchObject({ code: 'EEXIST' });
  });

  // THE test: a real repository, created and read back by the real library.
  it('inits a repo, commits, and reads the history back', async () => {
    await git.init({ fs, dir: DIR, defaultBranch: 'main' });
    await fs.writeFile('/workspace/readme.md', '# hello\n');
    await git.add({ fs, dir: DIR, filepath: 'readme.md' });
    const oid = await git.commit({ fs, dir: DIR, message: 'first commit', author: AUTHOR });

    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.currentBranch({ fs, dir: DIR })).toBe('main');

    const log = await git.log({ fs, dir: DIR });
    expect(log).toHaveLength(1);
    expect(log[0].commit.message.trim()).toBe('first commit');
    expect(log[0].commit.author.name).toBe('Cloud IDE');
  }, 30_000);

  it('tracks a second commit and keeps the first', async () => {
    await git.init({ fs, dir: DIR, defaultBranch: 'main' });
    await fs.writeFile('/workspace/a.txt', 'one');
    await git.add({ fs, dir: DIR, filepath: 'a.txt' });
    await git.commit({ fs, dir: DIR, message: 'one', author: AUTHOR });

    await fs.writeFile('/workspace/a.txt', 'two');
    await git.add({ fs, dir: DIR, filepath: 'a.txt' });
    await git.commit({ fs, dir: DIR, message: 'two', author: AUTHOR });

    const log = await git.log({ fs, dir: DIR });
    expect(log.map((entry) => entry.commit.message.trim())).toEqual(['two', 'one']);
  }, 30_000);

  it('sees a working-tree change as modified, and a new file as untracked', async () => {
    await git.init({ fs, dir: DIR, defaultBranch: 'main' });
    await fs.writeFile('/workspace/tracked.txt', 'v1');
    await git.add({ fs, dir: DIR, filepath: 'tracked.txt' });
    await git.commit({ fs, dir: DIR, message: 'seed', author: AUTHOR });

    // NOTE the length change. isomorphic-git keeps a stat cache in the index and skips
    // re-hashing when size AND mtime both match. OPFS `lastModified` has millisecond
    // resolution, so two same-length writes inside one millisecond can read as unchanged —
    // the classic "racily clean" problem, which real git solves and this library does not.
    // Harmless in practice here (VFS writes are debounced 2s apart), but it is a real edge
    // and worth having written down rather than rediscovered.
    await fs.writeFile('/workspace/tracked.txt', 'v2-longer');
    await fs.writeFile('/workspace/fresh.txt', 'new');

    const matrix = await git.statusMatrix({ fs, dir: DIR });
    const byPath = Object.fromEntries(matrix.map(([p, head, work, stage]) => [p, [head, work, stage]]));
    expect(byPath['tracked.txt']).toEqual([1, 2, 1]); // in HEAD, changed on disk, index stale
    expect(byPath['fresh.txt']).toEqual([0, 2, 0]);   // not in HEAD, present on disk
  }, 30_000);
});
