// The browser-tier store. OPFS doesn't exist in a node test environment, so the store takes
// its storage root as a seam and this supplies an in-memory fake of the handle API — which
// is why the handle types are declared structurally rather than imported from lib.dom.
//
// What's under test is the store's own logic: path walking, create-on-write semantics,
// listing, and the traversal guard. The fake is deliberately dumb.
import { describe, it, expect, beforeEach } from 'vitest';
import { OpfsFileStore, OpfsDirHandle, OpfsFileHandle, pathSegments } from './OpfsFileStore';

/** In-memory stand-in for a FileSystemDirectoryHandle. */
function fakeDir(): OpfsDirHandle {
  const dirs = new Map<string, OpfsDirHandle>();
  const files = new Map<string, string>();

  const fileHandle = (name: string): OpfsFileHandle => ({
    kind: 'file',
    async getFile() {
      return { async text() { return files.get(name)!; } };
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(data: string) { buffer += data; },
        async close() { files.set(name, buffer); },
      };
    },
  });

  return {
    kind: 'directory',
    async getDirectoryHandle(name, options) {
      if (!dirs.has(name)) {
        if (!options?.create) throw new Error(`NotFoundError: ${name}`);
        dirs.set(name, fakeDir());
      }
      return dirs.get(name)!;
    },
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new Error(`NotFoundError: ${name}`);
        files.set(name, '');
      }
      return fileHandle(name);
    },
    async removeEntry(name) {
      if (!files.delete(name) && !dirs.delete(name)) throw new Error(`NotFoundError: ${name}`);
    },
    entries() {
      const all: [string, OpfsDirHandle | OpfsFileHandle][] = [
        ...[...dirs.entries()].map(([n, h]) => [n, h] as [string, OpfsDirHandle]),
        ...[...files.keys()].map((n) => [n, fileHandle(n)] as [string, OpfsFileHandle]),
      ];
      return { async *[Symbol.asyncIterator]() { yield* all; } };
    },
  };
}

describe('pathSegments', () => {
  it('splits an absolute path and drops noise', () => {
    expect(pathSegments('/workspace/src/main.ts')).toEqual(['workspace', 'src', 'main.ts']);
    expect(pathSegments('/workspace//./a.txt')).toEqual(['workspace', 'a.txt']);
  });

  it('rejects traversal rather than sanitising it', () => {
    // A `..` in a stored path is never a legitimate write; rewriting it would hide the bug.
    expect(() => pathSegments('/workspace/../etc/passwd')).toThrow(/Unsafe/);
    expect(() => pathSegments('/a\0b')).toThrow(/Unsafe/);
    expect(() => pathSegments('/')).toThrow(/no segments/);
  });
});

describe('OpfsFileStore', () => {
  let store: OpfsFileStore;

  beforeEach(() => {
    const root = fakeDir();
    store = new OpfsFileStore('wsp-1', async () => root);
  });

  it('round-trips a file, creating parent directories on the way', async () => {
    await store.write('/workspace/src/deep/main.ts', 'export const x = 1;');
    expect(await store.read('/workspace/src/deep/main.ts')).toBe('export const x = 1;');
  });

  it('overwrites rather than appending on a second write', async () => {
    await store.write('/workspace/a.txt', 'first');
    await store.write('/workspace/a.txt', 'second');
    expect(await store.read('/workspace/a.txt')).toBe('second');
  });

  it('lists one level, tagging files and directories', async () => {
    await store.write('/workspace/a.txt', 'a');
    await store.write('/workspace/sub/b.txt', 'b');
    const entries = await store.list('/workspace');
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'a.txt', path: '/workspace/a.txt', type: 'file' },
        { name: 'sub', path: '/workspace/sub', type: 'directory' },
      ]),
    );
    expect(entries).toHaveLength(2); // one level only — b.txt is not here
  });

  // The bootstrap case: a brand-new browser workspace has genuinely nothing in it, and the
  // VFS lists the root before anything has ever been written.
  it('lists a directory that does not exist as EMPTY, not an error', async () => {
    await expect(store.list('/workspace')).resolves.toEqual([]);
  });

  it('removes a file, after which reading it fails', async () => {
    await store.write('/workspace/gone.txt', 'x');
    await store.remove('/workspace/gone.txt');
    await expect(store.read('/workspace/gone.txt')).rejects.toThrow();
  });

  it('refuses to read or write a traversing path', async () => {
    await expect(store.write('/workspace/../escape.txt', 'x')).rejects.toThrow(/Unsafe/);
    await expect(store.read('/workspace/../escape.txt')).rejects.toThrow(/Unsafe/);
  });

  it('keeps namespaces apart in one origin', async () => {
    const root = fakeDir();
    const mine = new OpfsFileStore('wsp-mine', async () => root);
    const yours = new OpfsFileStore('wsp-yours', async () => root);
    await mine.write('/workspace/secret.txt', 'mine');
    expect(await yours.list('/workspace')).toEqual([]);
  });

  it('has no readExternal — there is no filesystem outside the workspace here', () => {
    expect((store as any).readExternal).toBeUndefined();
  });
});
