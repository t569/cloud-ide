// The browser tier's git, against real isomorphic-git on the in-memory OPFS fake. These
// assert the two things that are genuinely ours: the status-matrix → porcelain translation
// the UI renders, and that a scoped commit really does leave unticked files behind.
import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserGitPort } from './BrowserGitPort';
import { porcelainFromMatrix } from './GitPort';
import { OpfsFs } from './OpfsFs';
import { fakeOpfsRoot } from './fakeOpfs';

describe('porcelainFromMatrix', () => {
  it('maps every state the UI has to render', () => {
    expect(porcelainFromMatrix(['f', 1, 1, 1])).toBeNull();  // clean → not listed
    expect(porcelainFromMatrix(['f', 0, 2, 0])).toBe('??');  // untracked
    expect(porcelainFromMatrix(['f', 0, 2, 2])).toBe('A ');  // new + staged
    expect(porcelainFromMatrix(['f', 1, 2, 1])).toBe(' M');  // modified, unstaged
    expect(porcelainFromMatrix(['f', 1, 2, 2])).toBe('M ');  // modified, staged
    expect(porcelainFromMatrix(['f', 1, 0, 1])).toBe(' D');  // deleted, unstaged
    expect(porcelainFromMatrix(['f', 1, 0, 0])).toBe('D ');  // deleted, staged
  });
});

describe('BrowserGitPort', () => {
  let fs: OpfsFs;
  let port: BrowserGitPort;

  beforeEach(async () => {
    const root = fakeOpfsRoot();
    fs = new OpfsFs('wsp-1', async () => root);
    await fs.mkdir('/workspace');
    port = new BrowserGitPort(fs);
    await port.init();
  });

  it('reports an untracked file, then a clean tree once committed', async () => {
    await fs.writeFile('/workspace/a.txt', 'hello');
    expect(await port.status()).toEqual([{ status: '??', path: 'a.txt' }]);

    await port.commit('first');
    expect(await port.status()).toEqual([]);
    expect(await port.branch()).toBe('main');
  }, 30_000);

  it('returns history in the shape the commit rail renders', async () => {
    await fs.writeFile('/workspace/a.txt', 'one');
    await port.commit('one', { name: 'Ada', email: 'ada@example.com' });

    const [entry] = await port.log();
    expect(entry.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.subject).toBe('one');
    expect(entry.author).toBe('Ada');
    expect(entry.date).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO, like the backend's %aI
  }, 30_000);

  // The behaviour the Source Control pane's checkboxes depend on.
  it('commits ONLY the ticked paths, leaving the rest uncommitted', async () => {
    await fs.writeFile('/workspace/picked.txt', 'yes');
    await fs.writeFile('/workspace/skipped.txt', 'no');

    await port.commit('only picked', undefined, ['picked.txt']);

    expect(await port.status()).toEqual([{ status: '??', path: 'skipped.txt' }]);
    expect((await port.log())[0].subject).toBe('only picked');
  }, 30_000);

  it('sees a deletion and commits it', async () => {
    await fs.writeFile('/workspace/gone.txt', 'x');
    await port.commit('add');
    await fs.unlink('/workspace/gone.txt');

    expect(await port.status()).toEqual([{ status: ' D', path: 'gone.txt' }]);
    await port.commit('remove');
    expect(await port.status()).toEqual([]);
  }, 30_000);

  it('refuses network operations with a legible reason when no CORS proxy is set', async () => {
    // A browser cannot reach a git host directly. Failing here beats an opaque fetch error.
    await expect(port.push()).rejects.toThrow(/CORS proxy/);
    await expect(port.pull()).rejects.toThrow(/CORS proxy/);
  });

  it('has no diff — isomorphic-git ships no unified-diff formatter', () => {
    expect((port as any).diff).toBeUndefined();
  });
});
