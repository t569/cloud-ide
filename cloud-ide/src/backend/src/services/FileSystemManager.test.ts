// Self-check for the VFS trust boundary (resolveHostPath): lexical `..` escapes
// AND symlink escapes must be refused; legitimate in-workspace I/O must work.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FileSystemManager } from './FileSystemManager';

describe('FileSystemManager path containment', () => {
  let worktree: string;   // the sandbox workspace root
  let outside: string;    // a sibling dir the sandbox must never reach
  let fm: FileSystemManager;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vfs-'));
    worktree = path.join(base, 'worktree');
    outside = path.join(base, 'outside');
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET');

    // Fake SandboxManager — only getWorkspaceHostPath is exercised here.
    fm = new FileSystemManager({ getWorkspaceHostPath: async () => worktree } as any);
  });
  afterEach(async () => {
    await fs.rm(path.dirname(worktree), { recursive: true, force: true });
  });

  it('reads and writes inside the workspace', async () => {
    await fm.writeFile('sbx', '/workspace/notes/hello.txt', 'hi');
    expect(await fm.readFile('sbx', '/workspace/notes/hello.txt')).toBe('hi');
    const listed = await fm.listDirectory('sbx', '/workspace');
    expect(listed.map((e) => e.name)).toContain('notes');
  });

  it('refuses lexical `..` traversal out of the workspace', async () => {
    await expect(fm.readFile('sbx', '/workspace/../outside/secret.txt')).rejects.toThrow(/escapes the workspace/);
    await expect(fm.readFile('sbx', '/workspace/../../etc/passwd')).rejects.toThrow(/escapes the workspace/);
  });

  it('refuses to read host files through a symlink checked out in the worktree', async () => {
    // Simulate a cloned repo that checked out `evil -> ../outside` (a dir link).
    // A directory junction needs no privilege on Windows and is a plain symlink
    // on POSIX, so this exercises the guard on every platform.
    await fs.symlink(outside, path.join(worktree, 'evil'), 'junction');
    await expect(fm.readFile('sbx', '/workspace/evil/secret.txt')).rejects.toThrow(/symlink/);
  });
});
