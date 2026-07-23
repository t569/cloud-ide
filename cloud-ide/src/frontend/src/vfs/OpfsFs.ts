// frontend/src/vfs/OpfsFs.ts
//
// A node-`fs`-shaped promises API over OPFS, so **isomorphic-git can run in the browser
// against the same tree the editor edits**. That single-tree property is the whole point:
// git's objects and the user's files must live in one place, or a commit records something
// the editor never wrote.
//
// This is deliberately a *lower* layer than FileStore. FileStore is the five text
// operations the VFS needs; git needs binary I/O, directory creation, stat and unlink, so
// it gets its own surface rather than bending the port out of shape. Both address the same
// OPFS namespace, so they see the same files.
//
// ponytail: the two share only a ~6-line directory walk. Collapsing FileStore onto this
// would cost a stat-per-entry in list() (OPFS hands back handles, node readdir hands back
// names), which is the wrong trade for the hot path.
//
// The detail that makes or breaks this: **isomorphic-git branches on `err.code`**. It
// expects ENOENT to mean "not there" and EEXIST from mkdir, and it recovers from both. An
// adapter that throws plain Errors makes the library fail in ways that look like data
// corruption, so every error below carries a code.

import { OpfsDirHandle, OpfsFileHandle, safeSegments } from './OpfsFileStore';

export interface FsError extends Error {
  code: string;
}

function fsError(code: string, path: string): FsError {
  const error = new Error(`${code}: ${path}`) as FsError;
  error.code = code;
  return error;
}

/** The subset of node's Stats that isomorphic-git actually reads. */
export interface OpfsStats {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function stats(type: 'file' | 'dir', size: number, mtimeMs: number): OpfsStats {
  return {
    type,
    // 0o100644 / 0o40000 — git stores a mode in every tree entry, so these must be sane.
    mode: type === 'file' ? 0o100644 : 0o040000,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => false,
  };
}

export class OpfsFs {
  private root?: Promise<OpfsDirHandle>;

  /**
   * The promises-shaped object isomorphic-git is handed as its `fs`.
   *
   * An OWN ENUMERABLE property, assigned here — deliberately not a class getter. The
   * library probes with `Object.getOwnPropertyDescriptor(fs, 'promises')`, which does not
   * see prototype accessors, so a getter silently falls through to the callback-style path
   * and dies in `bindFs`. Node's own `fs.promises` is an own property too.
   */
  public readonly promises: {
    readFile: OpfsFs['readFile'];
    writeFile: OpfsFs['writeFile'];
    unlink: OpfsFs['unlink'];
    readdir: OpfsFs['readdir'];
    mkdir: OpfsFs['mkdir'];
    rmdir: OpfsFs['rmdir'];
    stat: OpfsFs['stat'];
    lstat: OpfsFs['stat'];
    readlink: OpfsFs['readlink'];
    symlink: OpfsFs['symlink'];
  };

  constructor(
    private namespace: string,
    private getStorageRoot: () => Promise<OpfsDirHandle> = () =>
      (navigator as any).storage.getDirectory(),
  ) {
    this.promises = {
      readFile: this.readFile.bind(this),
      writeFile: this.writeFile.bind(this),
      unlink: this.unlink.bind(this),
      readdir: this.readdir.bind(this),
      mkdir: this.mkdir.bind(this),
      rmdir: this.rmdir.bind(this),
      stat: this.stat.bind(this),
      lstat: this.stat.bind(this), // no symlinks in OPFS, so lstat === stat
      readlink: this.readlink.bind(this),
      symlink: this.symlink.bind(this),
    };
  }

  private namespaceRoot(): Promise<OpfsDirHandle> {
    if (!this.root) {
      this.root = this.getStorageRoot().then((root) =>
        root.getDirectoryHandle(this.namespace, { create: true }),
      );
    }
    return this.root;
  }

  /** Walk to a directory. Any missing segment is ENOENT, which git relies on. */
  private async dirAt(segments: string[], create: boolean, forPath: string): Promise<OpfsDirHandle> {
    let handle = await this.namespaceRoot();
    for (const segment of segments) {
      try {
        handle = await handle.getDirectoryHandle(segment, { create });
      } catch {
        throw fsError('ENOENT', forPath);
      }
    }
    return handle;
  }

  private async parentOf(path: string, create: boolean): Promise<{ dir: OpfsDirHandle; name: string }> {
    const segments = safeSegments(path);
    const name = segments.pop();
    if (!name) throw fsError('EINVAL', path);
    return { dir: await this.dirAt(segments, create, path), name };
  }

  public async readFile(path: string, options?: { encoding?: string } | string): Promise<Uint8Array | string> {
    const { dir, name } = await this.parentOf(path, false);
    let handle: OpfsFileHandle;
    try {
      handle = await dir.getFileHandle(name);
    } catch {
      throw fsError('ENOENT', path);
    }
    const file: any = await handle.getFile();
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding) return file.text();
    // Git objects are binary; anything not explicitly text comes back as bytes.
    return new Uint8Array(await file.arrayBuffer());
  }

  public async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const { dir, name } = await this.parentOf(path, false);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data as any);
    } finally {
      await writable.close(); // uncommitted without this, even on the error path
    }
  }

  public async unlink(path: string): Promise<void> {
    const { dir, name } = await this.parentOf(path, false);
    try {
      await dir.removeEntry(name);
    } catch {
      throw fsError('ENOENT', path);
    }
  }

  public async readdir(path: string): Promise<string[]> {
    const dir = await this.dirAt(safeSegments(path), false, path);
    const names: string[] = [];
    for await (const [name] of dir.entries()) names.push(name);
    return names.sort(); // git walks trees in order; sorted output keeps it deterministic
  }

  public async mkdir(path: string): Promise<void> {
    const { dir, name } = await this.parentOf(path, false);
    // EEXIST vs ENOENT is exactly what isomorphic-git branches on to build parents.
    try {
      await dir.getDirectoryHandle(name);
      throw fsError('EEXIST', path);
    } catch (err) {
      if ((err as FsError).code === 'EEXIST') throw err;
    }
    await dir.getDirectoryHandle(name, { create: true });
  }

  public async rmdir(path: string): Promise<void> {
    const { dir, name } = await this.parentOf(path, false);
    try {
      await dir.removeEntry(name);
    } catch {
      throw fsError('ENOTEMPTY', path);
    }
  }

  public async stat(path: string): Promise<OpfsStats> {
    const segments = safeSegments(path);
    if (segments.length === 0) return stats('dir', 0, 0); // the root always exists

    const { dir, name } = await this.parentOf(path, false);
    try {
      const handle = await dir.getFileHandle(name);
      const file: any = await handle.getFile();
      return stats('file', file.size ?? 0, file.lastModified ?? 0);
    } catch {
      // not a file — try a directory before concluding it is absent
    }
    try {
      await dir.getDirectoryHandle(name);
      return stats('dir', 0, 0);
    } catch {
      throw fsError('ENOENT', path);
    }
  }

  /** OPFS has no symlinks. Reporting that honestly is better than faking one. */
  public async readlink(path: string): Promise<string> {
    throw fsError('EINVAL', path);
  }

  public async symlink(_target: string, path: string): Promise<void> {
    throw fsError('EPERM', path);
  }
}
