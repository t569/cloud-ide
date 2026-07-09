import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileSystemManager } from '../src/services/FileSystemManager';

describe('FileSystemManager (host-direct VFS)', () => {
  let workspaceRoot: string;
  let manager: FileSystemManager;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vfs-test-'));
    const sandboxManager = {
      getWorkspaceHostPath: jest.fn().mockResolvedValue(workspaceRoot),
    } as any;
    manager = new FileSystemManager(sandboxManager);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('lists directories with container-visible paths', async () => {
    await fs.mkdir(path.join(workspaceRoot, 'src'));
    await fs.writeFile(path.join(workspaceRoot, 'index.js'), 'console.log(1);');

    const files = await manager.listDirectory('sbx-1', '/workspace');

    expect(files).toEqual(
      expect.arrayContaining([
        { name: 'src', path: '/workspace/src', type: 'directory' },
        { name: 'index.js', path: '/workspace/index.js', type: 'file' },
      ])
    );
  });

  it('returns an empty list for a missing directory', async () => {
    await expect(manager.listDirectory('sbx-1', '/workspace/nope')).resolves.toEqual([]);
  });

  it('round-trips file content through write and read', async () => {
    const content = 'line one\nline two ✨';
    await manager.writeFile('sbx-1', '/workspace/deep/nested/file.txt', content);

    await expect(manager.readFile('sbx-1', '/workspace/deep/nested/file.txt')).resolves.toBe(content);
  });

  it('deletes files and directories recursively', async () => {
    await manager.writeFile('sbx-1', '/workspace/tmp/junk.txt', 'x');
    await manager.deletePath('sbx-1', '/workspace/tmp');

    await expect(fs.access(path.join(workspaceRoot, 'tmp'))).rejects.toThrow();
  });

  it('blocks path traversal out of the workspace', async () => {
    await expect(manager.readFile('sbx-1', '/workspace/../../etc/passwd')).rejects.toThrow(
      'escapes the workspace'
    );
    await expect(manager.writeFile('sbx-1', '../outside.txt', 'x')).rejects.toThrow(
      'escapes the workspace'
    );
  });

  it('refuses to delete the workspace root', async () => {
    await expect(manager.deletePath('sbx-1', '/workspace')).rejects.toThrow(
      'workspace root'
    );
  });
});
