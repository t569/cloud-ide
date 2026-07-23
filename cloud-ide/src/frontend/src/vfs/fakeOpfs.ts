// frontend/src/vfs/fakeOpfs.ts
//
// TEST SUPPORT ONLY — an in-memory stand-in for the OPFS handle API.
//
// OPFS does not exist in the node test environment, and the browser tier is the one place
// where getting storage wrong is invisible until a user loses work. So the stores take
// their storage root as a seam and tests drive them through this, which is also why the
// handle types are declared structurally rather than imported from lib.dom.
//
// Backed by Uint8Array rather than string: git objects are binary, and a fake that only
// held text would pass while the real thing corrupted every commit.
import { OpfsDirHandle, OpfsFileHandle } from './OpfsFileStore';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function fakeOpfsRoot(): OpfsDirHandle {
  const dirs = new Map<string, OpfsDirHandle>();
  const files = new Map<string, Uint8Array>();
  const times = new Map<string, number>();

  const fileHandle = (name: string): OpfsFileHandle => ({
    kind: 'file',
    async getFile() {
      const bytes = files.get(name) ?? new Uint8Array();
      return {
        size: bytes.length,
        lastModified: times.get(name) ?? 0,
        async text() { return decoder.decode(bytes); },
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length); },
      } as any;
    },
    async createWritable() {
      const chunks: Uint8Array[] = [];
      return {
        async write(data: any) {
          chunks.push(typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data));
        },
        async close() {
          files.set(name, concat(chunks));
          times.set(name, Date.now());
        },
      };
    },
  });

  return {
    kind: 'directory',
    async getDirectoryHandle(name, options) {
      if (!dirs.has(name)) {
        if (!options?.create) throw new Error(`NotFoundError: ${name}`);
        dirs.set(name, fakeOpfsRoot());
      }
      return dirs.get(name)!;
    },
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new Error(`NotFoundError: ${name}`);
        files.set(name, new Uint8Array());
        times.set(name, Date.now());
      }
      return fileHandle(name);
    },
    async removeEntry(name, options) {
      // Mirrors OPFS: removing a non-empty directory without recursive is an error, which
      // is what lets rmdir report ENOTEMPTY the way git expects.
      const dir = dirs.get(name);
      if (dir && !options?.recursive) {
        for await (const _ of dir.entries()) throw new Error('InvalidModificationError');
      }
      if (!files.delete(name) && !dirs.delete(name)) throw new Error(`NotFoundError: ${name}`);
      times.delete(name);
    },
    entries() {
      const all: [string, OpfsDirHandle | OpfsFileHandle][] = [
        ...[...dirs.entries()],
        ...[...files.keys()].map((n) => [n, fileHandle(n)] as [string, OpfsFileHandle]),
      ];
      return { async *[Symbol.asyncIterator]() { yield* all; } };
    },
  };
}
