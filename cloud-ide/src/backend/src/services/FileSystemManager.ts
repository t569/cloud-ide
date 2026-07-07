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

export class FileSystemManager {
  constructor(private sandboxManager: SandboxManager) {}

  /**
   * Maps a container-visible path (e.g. `/workspace/src/index.js`) to its
   * host equivalent inside the sandbox's worktree, and guarantees the result
   * cannot escape the worktree root (`..`, absolute tricks, etc.).
   * This guard is the VFS's trust boundary — every public method goes through it.
   */
  private async resolveHostPath(sandboxId: string, containerPath: string): Promise<string> {
    const hostRoot = await this.sandboxManager.getWorkspaceHostPath(sandboxId);

    let relative = containerPath;
    if (relative === CONTAINER_WORKSPACE) {
      relative = '.';
    } else if (relative.startsWith(`${CONTAINER_WORKSPACE}/`)) {
      relative = relative.slice(CONTAINER_WORKSPACE.length + 1);
    } else {
      relative = relative.replace(/^\/+/, '');
    }

    const resolved = path.resolve(hostRoot, relative);
    if (resolved !== hostRoot && !resolved.startsWith(hostRoot + path.sep)) {
      throw new Error(`Path escapes the workspace: ${containerPath}`);
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
    const hostRoot = await this.sandboxManager.getWorkspaceHostPath(sandboxId);
    if (hostPath === hostRoot) {
      throw new Error('Refusing to delete the workspace root.');
    }
    await fs.rm(hostPath, { recursive: true, force: true });
  }
}
