// frontend/src/vfs/OpfsFileStore.ts
//
// The FileStore backed by the ORIGIN PRIVATE FILE SYSTEM — the browser's own disk. This is
// what makes the free tier free: no server holds the files, so there is no worktree to keep
// alive and nothing to pay for. OPFS is a native browser API, so this costs no dependency.
//
// Paths map 1:1 onto the directory tree: `/workspace/src/main.ts` becomes `workspace/src/`
// + `main.ts` beneath the namespace root. Keeping the mapping literal means a path in the
// VFS map, a path on the wire and a path in OPFS are all the same string.
//
// The handle types below are declared STRUCTURALLY rather than imported from lib.dom, for
// two reasons: the store can then be exercised in a node test with an in-memory fake, and
// it does not break when a TS lib version disagrees about the shape of OPFS.

import { FileStore, StoreEntry } from './FileStore';

export interface OpfsFileHandle {
  kind: 'file';
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export interface OpfsDirHandle {
  kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, OpfsDirHandle | OpfsFileHandle]>;
}

/**
 * Split an absolute path into directory segments.
 *
 * Rejects rather than sanitises — `..` in a stored path is never a legitimate write, and
 * silently rewriting it would hide whatever produced it. Same rule as VFSController.safePath.
 */
export function pathSegments(path: string): string[] {
  if (!path || path.includes('\0')) throw new Error(`Unsafe path: ${JSON.stringify(path)}`);
  const segments = path.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) throw new Error(`Unsafe path: ${path}`);
  if (segments.length === 0) throw new Error(`Path has no segments: ${path}`);
  return segments;
}

export class OpfsFileStore implements FileStore {
  private root?: Promise<OpfsDirHandle>;

  constructor(
    /** One subtree per workspace, so two workspaces cannot collide in one origin. */
    private namespace: string,
    /** Seam for tests; in a browser this is the real OPFS root. */
    private getStorageRoot: () => Promise<OpfsDirHandle> = () =>
      (navigator as any).storage.getDirectory(),
  ) {}

  /** Namespace root, created once and memoised — every operation starts here. */
  private namespaceRoot(): Promise<OpfsDirHandle> {
    if (!this.root) {
      this.root = this.getStorageRoot().then((root) =>
        root.getDirectoryHandle(this.namespace, { create: true }),
      );
    }
    return this.root;
  }

  /** Walk `segments` from the namespace root, optionally creating as it goes. */
  private async dir(segments: string[], create: boolean): Promise<OpfsDirHandle> {
    let handle = await this.namespaceRoot();
    for (const segment of segments) {
      handle = await handle.getDirectoryHandle(segment, { create });
    }
    return handle;
  }

  /** Split a file path into (parent dir handle, file name). */
  private async parentOf(path: string, create: boolean): Promise<{ dir: OpfsDirHandle; name: string }> {
    const segments = pathSegments(path);
    const name = segments.pop()!;
    return { dir: await this.dir(segments, create), name };
  }

  /**
   * One directory level. A directory that does not exist lists as EMPTY rather than
   * throwing: on this tier a brand-new workspace genuinely has nothing in it, and the VFS
   * bootstraps by listing the root before anything has ever been written to it.
   */
  public async list(dirPath: string): Promise<StoreEntry[]> {
    let dir: OpfsDirHandle;
    try {
      dir = await this.dir(pathSegments(dirPath), false);
    } catch {
      return [];
    }
    const entries: StoreEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      entries.push({
        name,
        path: `${dirPath.replace(/\/$/, '')}/${name}`,
        type: handle.kind === 'directory' ? 'directory' : 'file',
      });
    }
    return entries;
  }

  public async read(path: string): Promise<string> {
    const { dir, name } = await this.parentOf(path, false);
    const file = await dir.getFileHandle(name);
    return (await file.getFile()).text();
  }

  public async write(path: string, content: string): Promise<void> {
    // `create: true` all the way down — a write to a new nested path must not require the
    // caller to have created the directories, which is what the HTTP store does too.
    const { dir, name } = await this.parentOf(path, true);
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(content);
    } finally {
      // Without close() the write is never committed, so it must survive a throw above.
      await writable.close();
    }
  }

  public async remove(path: string): Promise<void> {
    const { dir, name } = await this.parentOf(path, false);
    // recursive: the VFS deletes directories as single nodes, same as DELETE /delete.
    await dir.removeEntry(name, { recursive: true });
  }

  // No readExternal: in the browser there is no filesystem outside the workspace. The
  // capability's absence is the honest answer, so the port leaves it optional.
}
