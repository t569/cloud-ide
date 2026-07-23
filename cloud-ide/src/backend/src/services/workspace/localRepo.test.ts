// The gate on local clone sources. This is a filesystem read primitive, so the cases that
// matter are the ESCAPES: off by default, and no walking out of the declared root.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSourceUrlAllowed } from './localRepo';

describe('assertSourceUrlAllowed', () => {
  let root: string;
  let inside: string;
  let outside: string;
  const savedEnv = process.env.CIDE_LOCAL_REPO_ROOT;

  beforeEach(async () => {
    const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'localrepo-')));
    root = path.join(tmp, 'projects');
    inside = path.join(root, 'mine');
    outside = path.join(tmp, 'secrets');
    await fs.mkdir(inside, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    process.env.CIDE_LOCAL_REPO_ROOT = root;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CIDE_LOCAL_REPO_ROOT;
    else process.env.CIDE_LOCAL_REPO_ROOT = savedEnv;
  });

  it('always allows an http(s) remote', async () => {
    delete process.env.CIDE_LOCAL_REPO_ROOT; // the knob is irrelevant to remotes
    await expect(assertSourceUrlAllowed('https://github.com/o/r.git')).resolves.toBeUndefined();
  });

  it('refuses every local path when no root is declared (the production default)', async () => {
    delete process.env.CIDE_LOCAL_REPO_ROOT;
    await expect(assertSourceUrlAllowed(inside)).rejects.toThrow(/http\(s\) git URL/);
  });

  it('allows a path inside the declared root', async () => {
    await expect(assertSourceUrlAllowed(inside)).resolves.toBeUndefined();
  });

  it('refuses a traversal out of the root', async () => {
    await expect(assertSourceUrlAllowed(path.join(root, '..', 'secrets'))).rejects.toThrow(/outside/);
  });

  it('refuses a SYMLINK inside the root that points out of it', async () => {
    // The whole reason both sides are realpath'd. A lexical check passes this.
    const link = path.join(root, 'looks-legit');
    try {
      await fs.symlink(outside, link, 'junction');
    } catch {
      return; // unprivileged Windows can't make links; the lexical cases above still ran
    }
    await expect(assertSourceUrlAllowed(link)).rejects.toThrow(/outside/);
  });

  it('refuses a path that does not exist', async () => {
    await expect(assertSourceUrlAllowed(path.join(root, 'nope'))).rejects.toThrow(/does not exist/);
  });
});
