// The tree is keyed on CONTAINER paths (/workspace/...) because hydrateWorkspace
// walks /workspace and chokidar reports the same. The UI does not know that: the
// "New File" prompt defaults to `/new_file.txt` and the upload handler uses
// `/${file.name}`. Unrooted, the VFS held `/new_file.txt` while the backend wrote
// the file into the worktree root -- which IS /workspace -- so the watcher reported
// `/workspace/new_file.txt` and applyPatch inserted a SECOND node for one file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem';

beforeEach(() => {
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} });
});

const vfs = () => new VirtualFileSystem('sbx-1', () => {});

describe('UI paths are rooted under the workspace', () => {
  it('creates an unrooted file under /workspace', async () => {
    const fs = vfs();
    fs.createFileOrDir('/new_file.txt', 'file');
    await expect(fs.readFile('/workspace/new_file.txt')).resolves.toBe('');
  });

  it('does not create a phantom /workspace node wrapping the tree', () => {
    const fs = vfs();
    fs.createFileOrDir('/new_file.txt', 'file');
    const tree = fs.getNestedTree();
    expect(tree.map((n) => n.path)).toEqual(['/workspace/new_file.txt']);
  });

  it('an already-rooted path is left alone (idempotent, so renameNode round-trips)', async () => {
    const fs = vfs();
    fs.createFileOrDir('/workspace/a.txt', 'file');
    expect(() => fs.createFileOrDir('/a.txt', 'file')).toThrow('Path already exists');
  });

  it('the watcher patch for the same file does not add a second node', () => {
    const fs = vfs();
    fs.createFileOrDir('/new_file.txt', 'file');
    // chokidar reports the container path for the file we just wrote.
    fs.applyPatch([{ kind: 'add', path: '/workspace/new_file.txt' }]);
    expect(fs.getNestedTree().map((n) => n.path)).toEqual(['/workspace/new_file.txt']);
  });

  it('nested creation makes the intermediate dir, not the root', () => {
    const fs = vfs();
    fs.createFileOrDir('/jack/robinson.asm', 'file'); // the prompt's own example
    const tree = fs.getNestedTree();
    expect(tree.map((n) => n.path)).toEqual(['/workspace/jack']);
    expect(tree[0].children?.map((n) => n.path)).toEqual(['/workspace/jack/robinson.asm']);
  });

  it('the upload cycle (create → edit → open) hits one node', async () => {
    const fs = vfs();
    fs.createFileOrDir('/upload.txt', 'file');
    fs.updateFile('/upload.txt', 'hello');
    await expect(fs.readFile('/upload.txt')).resolves.toBe('hello');
    await expect(fs.readFile('/workspace/upload.txt')).resolves.toBe('hello');
  });
});
