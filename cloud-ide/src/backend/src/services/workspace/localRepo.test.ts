// The gate on non-http clone sources. Only the server's own unpacked-archive root is a
// legal local source, so the cases that matter are the ESCAPES from it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSourceUrlAllowed, WORKSPACE_SOURCES_ROOT } from './localRepo';

describe('assertSourceUrlAllowed', () => {
  let inside: string;
  let outside: string;

  beforeEach(async () => {
    await fs.mkdir(WORKSPACE_SOURCES_ROOT, { recursive: true });
    inside = path.join(WORKSPACE_SOURCES_ROOT, 'wsp-test');
    // A sibling of the root — i.e. elsewhere under the data dir, where central-repo.git and
    // every tenant's worktree live. This is the thing the check exists to keep unreachable.
    outside = path.join(WORKSPACE_SOURCES_ROOT, '..', 'not-a-source');
    await fs.mkdir(inside, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(inside, { recursive: true, force: true }).catch(() => {});
    await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
  });

  it('allows an http(s) remote', async () => {
    await expect(assertSourceUrlAllowed('https://github.com/o/r.git')).resolves.toBeUndefined();
  });

  it('allows an unpacked source directory the server owns', async () => {
    await expect(assertSourceUrlAllowed(inside)).resolves.toBeUndefined();
  });

  it('refuses a traversal out of the sources root', async () => {
    await expect(assertSourceUrlAllowed(outside)).rejects.toThrow(/http\(s\) git URL/);
  });

  it('refuses a SYMLINK inside the root that points out of it', async () => {
    // The whole reason both sides are realpath'd — a lexical check passes this.
    const link = path.join(WORKSPACE_SOURCES_ROOT, 'looks-legit');
    try {
      await fs.symlink(path.resolve(outside), link, 'junction');
    } catch {
      return; // unprivileged Windows can't link; the lexical cases above still ran
    }
    try {
      await expect(assertSourceUrlAllowed(link)).rejects.toThrow(/http\(s\) git URL/);
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('refuses a git transport that executes a command', async () => {
    // `ext::` runs a shell command as a "remote". It is not a path, so realpath kills it.
    await expect(assertSourceUrlAllowed('ext::sh -c "id>&2"')).rejects.toThrow(/http\(s\) git URL/);
  });

  it('refuses a path that does not exist', async () => {
    await expect(assertSourceUrlAllowed(path.join(WORKSPACE_SOURCES_ROOT, 'nope'))).rejects.toThrow(/http\(s\) git URL/);
  });
});
