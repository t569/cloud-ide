// Lazy tree loading: the boot walk lists heavy dirs (node_modules, …) as collapsed
// folders but must NOT recurse into them — that recursion was the request storm that
// stalled hydration on a real project. Their contents load on expand instead.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake /ls backend: one directory tree, records every path listed so we can prove
// node_modules' interior was never walked at boot.
const listed: string[] = [];
const TREE: Record<string, { name: string; path: string; type: 'file' | 'directory' }[]> = {
  '/workspace': [
    { name: 'src', path: '/workspace/src', type: 'directory' },
    { name: 'node_modules', path: '/workspace/node_modules', type: 'directory' },
    { name: 'package.json', path: '/workspace/package.json', type: 'file' },
  ],
  '/workspace/src': [{ name: 'index.ts', path: '/workspace/src/index.ts', type: 'file' }],
  '/workspace/node_modules': [{ name: 'react', path: '/workspace/node_modules/react', type: 'directory' }],
  '/workspace/node_modules/react': [{ name: 'index.js', path: '/workspace/node_modules/react/index.js', type: 'file' }],
};

vi.mock('../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(async (url: string) => {
      const path = decodeURIComponent(new URLSearchParams(url.split('?')[1]).get('path')!);
      listed.push(path);
      return TREE[path] ?? [];
    }),
  },
}));

import { VirtualFileSystem } from './VirtualFileSystem';

beforeEach(() => {
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} });
  listed.length = 0;
});

const paths = (nodes: any[]): string[] => nodes.flatMap((n) => [n.path, ...(n.children ? paths(n.children) : [])]);

describe('lazy tree loading', () => {
  it('lists node_modules at boot but does not walk its interior', async () => {
    const vfs = new VirtualFileSystem('sbx-1', () => {});
    const tree = await vfs.hydrateWorkspace();

    // Source is eagerly walked (available to Quick Open); node_modules shows collapsed.
    expect(paths(tree)).toContain('/workspace/src/index.ts');
    expect(paths(tree)).toContain('/workspace/node_modules');
    expect(paths(tree)).not.toContain('/workspace/node_modules/react');

    // The storm we're preventing: node_modules' interior was never listed.
    expect(listed).not.toContain('/workspace/node_modules');
  });

  it('loads a heavy dir one level on expand, and is a no-op when re-expanded', async () => {
    const vfs = new VirtualFileSystem('sbx-1', () => {});
    await vfs.hydrateWorkspace();

    const tree = await vfs.loadChildren('/workspace/node_modules');
    expect(paths(tree)).toContain('/workspace/node_modules/react'); // one level in
    expect(paths(tree)).not.toContain('/workspace/node_modules/react/index.js'); // not deeper
    expect(listed).toContain('/workspace/node_modules');

    listed.length = 0;
    await vfs.loadChildren('/workspace/node_modules'); // already loaded
    expect(listed).toEqual([]);
  });
});
