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

// Files outside /workspace exist only in the container, so readExternalFile must
// go through exec — never the host. If it ever regressed to resolveHostPath, a
// read of /etc/hosts would silently serve <worktree>/etc/hosts (wrong file), and
// a write would forge one.
describe('FileSystemManager.readExternalFile', () => {
  let execBuffered: jest.Mock;
  let fm: FileSystemManager;

  const withExec = (result: { stdout: string; stderr?: string; exitCode: number }) => {
    execBuffered = jest.fn().mockResolvedValue({ stderr: '', ...result });
    fm = new FileSystemManager({
      execBuffered,
      // Reaching for the host path at all is the bug this guards against.
      getWorkspaceHostPath: async () => { throw new Error('must not touch the host'); },
    } as any);
  };

  it('reads through the container as argv, capped, and never touches the host', async () => {
    withExec({ stdout: '127.0.0.1 localhost', exitCode: 0 });

    expect(await fm.readExternalFile('sbx', '/etc/hosts')).toBe('127.0.0.1 localhost');

    const [sandboxId, payload] = execBuffered.mock.calls[0];
    expect(sandboxId).toBe('sbx');
    // argv, not a shell string: no injection surface even though the path is user input.
    expect(Array.isArray(payload.command)).toBe(true);
    expect(payload.command).toEqual(['head', '-c', expect.any(String), '--', '/etc/hosts']);
    expect(Number(payload.command[2])).toBeGreaterThan(0);
  });

  it('refuses a relative path, a NUL byte, a non-zero exit, and binary content', async () => {
    withExec({ stdout: '', exitCode: 0 });
    await expect(fm.readExternalFile('sbx', 'etc/hosts')).rejects.toThrow(/absolute/);
    await expect(fm.readExternalFile('sbx', '/etc/ho\0sts')).rejects.toThrow(/absolute/);
    expect(execBuffered).not.toHaveBeenCalled(); // rejected before it ever ran

    withExec({ stdout: '', exitCode: 1 }); // missing file, or a directory
    await expect(fm.readExternalFile('sbx', '/nope')).rejects.toThrow(/Cannot read/);

    withExec({ stdout: 'ELF\0\0\0', exitCode: 0 });
    await expect(fm.readExternalFile('sbx', '/bin/ls')).rejects.toThrow(/text file/);
  });
});
