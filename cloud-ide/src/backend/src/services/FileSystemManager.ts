// backend/src/services/FileSystemManager.ts
import { SandboxExecRequest } from '@cloud-ide/shared/types/sandbox';
import { SandboxManager } from './sandbox/SandboxManager';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export class FileSystemManager {
  constructor(private sandboxManager: SandboxManager) {}

  private async execContainerCommand(sandboxId: string, request: SandboxExecRequest): Promise<string> {
    const result = await this.sandboxManager.execBuffered(sandboxId, request);

    if (result.exitCode !== 0) {
      throw new Error(
        `Container Command Failed (Code ${result.exitCode}):\n${result.stderr || 'Unknown Error'}`
      );
    }

    return result.stdout.trim();
  }
  // SECURITY (finding #6): all methods below pass user-supplied paths as argv,
  // NOT interpolated into a `/bin/sh -c` string. execBuffered runs the command
  // execve-style (no shell), so a path containing ", `, $(...), or ; is just a
  // literal argument and cannot inject commands. The one place a shell is
  // unavoidable (writeFile's pipe+redirect) passes untrusted values as shell
  // POSITIONAL PARAMETERS ($1/$2), which the shell never re-parses as code.

  /**
   * Lists all files and directories in a given path.
   */
  public async listDirectory(sandboxId: string, dirPath: string = '/workspace'): Promise<FileNode[]> {
    try {
      // `ls -1p` appends a trailing '/' to directories; classify in Node rather
      // than piping to awk (a pipe would require an injectable shell string).
      const output = await this.execContainerCommand(sandboxId, {
        command: ['ls', '-1p', dirPath],
        cwd: '/workspace',
      });

      if (!output.trim()) return [];

      return output.trim().split('\n').map(line => {
        const isDir = line.endsWith('/');
        const name = isDir ? line.slice(0, -1) : line;
        return {
          name,
          path: `${dirPath === '/' ? '' : dirPath}/${name}`,
          type: isDir ? 'directory' : 'file'
        };
      });
    } catch (err: any) {
      if (err.message.includes('No such file or directory')) return [];
      throw err;
    }
  }

  /**
   * Reads a file's content securely using Base64.
   */
  public async readFile(sandboxId: string, filePath: string): Promise<string> {
    // Encode to base64 inside the container to preserve line breaks, emojis, and
    // binary bytes over HTTP. filePath is passed as argv, not shell-interpolated.
    const base64Output = await this.execContainerCommand(sandboxId, {
      command: ['base64', filePath],
      cwd: '/workspace',
    });
    return Buffer.from(base64Output.trim(), 'base64').toString('utf-8');
  }

  /**
   * Writes content to a file securely using Base64.
   */
  public async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    const b64Content = Buffer.from(content).toString('base64');

    // Ensure the parent directory exists first (argv, no shell).
    const dirName = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dirName) {
      await this.execContainerCommand(sandboxId, {
        command: ['mkdir', '-p', dirName],
        cwd: '/workspace',
      });
    }

    // Write needs a pipe + redirect, so a shell is unavoidable (the exec API has
    // no stdin). Pass the b64 content and the target path as positional args
    // ($1, $2) — the shell substitutes them as literal data, never as code, so
    // there is no injection. `printf %s` (not echo) avoids flag/escape parsing.
    await this.execContainerCommand(sandboxId, {
      command: ['/bin/sh', '-c', 'printf %s "$1" | base64 -d > "$2"', 'sh', b64Content, filePath],
      cwd: '/workspace',
    });
  }

  /**
   * Deletes a file or directory.
   */
  public async deletePath(sandboxId: string, pathToRemove: string): Promise<void> {
    // rm -rf via argv; pathToRemove is a literal argument, not shell-parsed.
    await this.execContainerCommand(sandboxId, {
      command: ['rm', '-rf', pathToRemove],
      cwd: '/workspace',
    });
  }
}

