import { describe, it, expect } from 'vitest';
import { flattenFiles, fuzzyMatch } from './quickOpen';
import { FileNode } from '../types/editor';

const tree: FileNode[] = [
  { name: 'src', path: '/src', type: 'directory', children: [
    { name: 'main.py', path: '/src/main.py', type: 'file' },
    { name: 'util', path: '/src/util', type: 'directory', children: [
      { name: 'io.py', path: '/src/util/io.py', type: 'file' },
    ]},
  ]},
  { name: 'README.md', path: '/README.md', type: 'file' },
];

describe('flattenFiles', () => {
  it('collects only files, recursively, keeping full paths', () => {
    expect(flattenFiles(tree).map(f => f.path)).toEqual([
      '/src/main.py', '/src/util/io.py', '/README.md',
    ]);
  });
});

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('mpy', '/src/main.py')).toBe(true);   // m..p..y
    expect(fuzzyMatch('README', '/readme.md')).toBe(true);
    expect(fuzzyMatch('', '/anything')).toBe(true);         // empty = all
  });
  it('rejects when chars are out of order or missing', () => {
    expect(fuzzyMatch('ypm', '/src/main.py')).toBe(false);
    expect(fuzzyMatch('xyz', '/src/main.py')).toBe(false);
  });
});
