import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem';
import type { FileNode } from './types/vfs';

// The VFS constructor starts a window.setInterval sync loop; vitest runs in the
// node env by default, so stub the two timer globals it touches.
beforeEach(() => {
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} });
});

/** Flatten the nested UI tree to a set of paths for easy assertions. */
function paths(tree: FileNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: FileNode[]) => nodes.forEach((n) => {
    out.add(n.path);
    if (n.children) walk(n.children);
  });
  walk(tree);
  return out;
}

describe('VirtualFileSystem.applyPatch', () => {
  it('adds new paths from disk', () => {
    const vfs = new VirtualFileSystem('sbx', () => {});
    const tree = vfs.applyPatch([
      { kind: 'addDir', path: '/workspace/src' },
      { kind: 'add', path: '/workspace/src/app.ts' },
    ]);
    expect(paths(tree).has('/workspace/src/app.ts')).toBe(true);
  });

  it('removes clean paths but PRESERVES dirty (unsaved) ones', () => {
    const vfs = new VirtualFileSystem('sbx', () => {});
    // Two files land from disk (clean)...
    vfs.applyPatch([
      { kind: 'add', path: '/workspace/clean.ts' },
      { kind: 'add', path: '/workspace/dirty.ts' },
    ]);
    // ...the user edits one locally (now dirty/unsynced).
    vfs.updateFile('/workspace/dirty.ts', 'unsaved work');

    // A disk change deletes BOTH. The dirty one must survive.
    const tree = vfs.applyPatch([
      { kind: 'unlink', path: '/workspace/clean.ts' },
      { kind: 'unlink', path: '/workspace/dirty.ts' },
    ]);

    const p = paths(tree);
    expect(p.has('/workspace/clean.ts')).toBe(false);
    expect(p.has('/workspace/dirty.ts')).toBe(true);
  });

  it('unlinkDir drops the subtree but keeps a dirty child', () => {
    const vfs = new VirtualFileSystem('sbx', () => {});
    vfs.applyPatch([
      { kind: 'addDir', path: '/workspace/pkg' },
      { kind: 'add', path: '/workspace/pkg/a.ts' },
      { kind: 'add', path: '/workspace/pkg/b.ts' },
    ]);
    vfs.updateFile('/workspace/pkg/b.ts', 'edited');

    const tree = vfs.applyPatch([{ kind: 'unlinkDir', path: '/workspace/pkg' }]);
    const p = paths(tree);
    expect(p.has('/workspace/pkg/a.ts')).toBe(false);
    expect(p.has('/workspace/pkg/b.ts')).toBe(true); // dirty child preserved
  });
});
