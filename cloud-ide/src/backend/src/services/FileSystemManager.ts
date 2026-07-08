// backend/src/services/FileSystemManager.ts
//
// Host-direct Virtual File System.
//
// The sandbox's /workspace is a Git worktree bind-mounted from the host SSD,
// so every VFS operation runs against the host filesystem with node:fs —
// zero container round-trips, no shell involved (no injection surface), and
// it works even while the sandbox is PAUSED, which keeps Scale-to-Zero intact.
//
// The previous implementation shelled into the container per operation
// (ls/base64 via execd); it was removed once every sandbox got a host mount.
// ponytail: single-node assumption — gateway and worktrees share a disk.
// If the gateway ever splits from sandbox hosts, reintroduce a provider
// interface and an agent-backed implementation behind it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxManager } from './sandbox/SandboxManager';
import { VfsNode } from '@cloud-ide/shared';

const CONTAINER_WORKSPACE = '/workspace';

/**
 * Realpath the deepest EXISTING ancestor of `p` (p itself may not exist yet —
 * e.g. a file about to be written). Resolves any symlinks in that existing
 * chain, so the caller can verify the real on-disk location, not just the
 * lexical one. Climbs on ENOENT until something exists (worst case: fs root).
 */
async function realpathOfNearestExisting(p: string): Promise<string> {
  let current = p;
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) return current; // reached the filesystem root
      current = parent;
    }
  }
}

export class FileSystemManager {
  constructor(private sandboxManager: SandboxManager) {}

  /** Lexical map of a container path to a host path under `root`, rejecting any
   *  result that escapes `root` via `..`/absolute tricks (string-level guard). */
  private toResolved(root: string, containerPath: string): string {
    let relative = containerPath;
    if (relative === CONTAINER_WORKSPACE) {
      relative = '.';
    } else if (relative.startsWith(`${CONTAINER_WORKSPACE}/`)) {
      relative = relative.slice(CONTAINER_WORKSPACE.length + 1);
    } else {
      relative = relative.replace(/^\/+/, '');
    }

    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the workspace: ${containerPath}`);
    }
    return resolved;
  }

  /**
   * Maps a container-visible path (e.g. `/workspace/src/index.js`) to its host
   * equivalent inside the sandbox's worktree, guaranteeing the result cannot
   * escape the worktree root. This guard is the VFS's trust boundary — every
   * public method goes through it. It blocks two distinct escapes:
   *   1. Lexical (`..`, absolute paths) — the `toResolved` string guard.
   *   2. Symlink — a worktree may contain a symlink (a cloned repo can check one
   *      out) pointing at `/etc` or another sandbox's worktree; `path.resolve`
   *      won't follow it but `node:fs` would. We realpath the deepest existing
   *      ancestor and require it to stay inside the real root, blocking host and
   *      cross-tenant reads.
   * ponytail: the realpath check is TOCTOU-race-free enough for a single writer
   * (git checkout). If untrusted concurrent symlink creation ever exists, switch
   * the fs calls to O_NOFOLLOW opens.
   */
  private async resolveHostPath(sandboxId: string, containerPath: string): Promise<string> {
    const hostRoot = await this.sandboxManager.getWorkspaceHostPath(sandboxId);

    // Canonicalize the root itself (symlinks in the worktree path). A not-yet-
    // created worktree has nothing to traverse into — the lexical guard alone is
    // sufficient there (no files ⇒ no symlinks).
    let realRoot: string;
    try {
      realRoot = await fs.realpath(hostRoot);
    } catch (err: any) {
      if (err.code === 'ENOENT') return this.toResolved(hostRoot, containerPath);
      throw err;
    }

    const resolved = this.toResolved(realRoot, containerPath);

    const realTarget = await realpathOfNearestExisting(resolved);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(`Path escapes the workspace via symlink: ${containerPath}`);
    }
    return resolved;
  }

  /**
   * Lists all files and directories in a given path (container-relative).
   * Returns container-visible paths so the frontend never sees host layout.
   */
  public async listDirectory(sandboxId: string, dirPath: string = CONTAINER_WORKSPACE): Promise<VfsNode[]> {
    const hostPath = await this.resolveHostPath(sandboxId, dirPath);

    let entries;
    try {
      entries = await fs.readdir(hostPath, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    return entries.map((entry) => ({
      name: entry.name,
      path: `${dirPath === '/' ? '' : dirPath}/${entry.name}`,
      type: entry.isDirectory() ? 'directory' as const : 'file' as const,
    }));
  }

  /**
   * Reads a file's content as UTF-8.
   */
  public async readFile(sandboxId: string, filePath: string): Promise<string> {
    const hostPath = await this.resolveHostPath(sandboxId, filePath);
    return fs.readFile(hostPath, 'utf-8');
  }

  /**
   * Writes content to a file, creating parent directories as needed.
   */
  public async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    const hostPath = await this.resolveHostPath(sandboxId, filePath);
    await fs.mkdir(path.dirname(hostPath), { recursive: true });
    await fs.writeFile(hostPath, content, 'utf-8');
  }

  /**
   * Deletes a file or directory (recursive). Refuses to delete the workspace
   * root itself — that would destroy the worktree's own Git link.
   */
  public async deletePath(sandboxId: string, pathToRemove: string): Promise<void> {
    const hostPath = await this.resolveHostPath(sandboxId, pathToRemove);
    // Compare against the canonical root — resolveHostPath returns paths rooted
    // at the realpath'd worktree, so a raw getWorkspaceHostPath could mismatch.
    const rawRoot = await this.sandboxManager.getWorkspaceHostPath(sandboxId);
    const realRoot = await fs.realpath(rawRoot).catch(() => path.resolve(rawRoot));
    if (hostPath === realRoot) {
      throw new Error('Refusing to delete the workspace root.');
    }
    await fs.rm(hostPath, { recursive: true, force: true });
  }
}
