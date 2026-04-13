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
  /**
   * Lists all files and directories in a given path
   */
  public async listDirectory(sandboxId: string, dirPath: string = '/workspace'): Promise<FileNode[]> {
    // Uses standard Linux 'ls' to format output as "filename|type" (e.g., "src|d" or "index.js|f")
    const shellScript = `ls -1p "${dirPath}" | awk '{if(substr($0,length($0),1)=="/") print substr($0,1,length($0)-1)"|d"; else print $0"|f"}'`;
    
    try {
      const output = await this.execContainerCommand(sandboxId, {
        command: ['/bin/sh', '-c', shellScript],
        cwd: '/workspace',
      });
      
      if (!output.trim()) return [];

      return output.trim().split('\n').map(line => {
        const [name, typeChar] = line.split('|');
        return {
          name,
          path: `${dirPath === '/' ? '' : dirPath}/${name}`,
          type: typeChar === 'd' ? 'directory' : 'file'
        };
      });
    } catch (err: any) {
      if (err.message.includes('No such file or directory')) return [];
      throw err;
    }
  }

  /**
   * Reads a file's content securely using Base64
   */
 public async readFile(sandboxId: string, filePath: string): Promise<string> {
    // We encode the file to base64 inside the container before sending it over HTTP
    // This perfectly preserves line breaks, emojis, and special characters.
    const base64Output = await this.execContainerCommand(sandboxId, {
      command: ['/bin/sh', '-c', `base64 "${filePath}"`],
      cwd: '/workspace',
    });
    return Buffer.from(base64Output.trim(), 'base64').toString('utf-8');
  }

  /**
   * Writes content to a file securely using Base64
   */
  public async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
     const b64Content = Buffer.from(content).toString('base64');
    
    // Ensure the parent directory exists first (mkdir -p)
    const dirName = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.execContainerCommand(sandboxId, {
      command: ['/bin/sh', '-c', `mkdir -p "${dirName}"`],
      cwd: '/workspace',
    });

    // Write the file
    await this.execContainerCommand(sandboxId, {
      command: ['/bin/sh', '-c', `echo "${b64Content}" | base64 -d > "${filePath}"`],
      cwd: '/workspace',
    });
  }

  /**
   * Deletes a file or directory
   */
  public async deletePath(sandboxId: string, pathToRemove: string): Promise<void> {
    // rm -rf safely removes files or recursively deletes folders
    await this.execContainerCommand(sandboxId, {
      command: ['/bin/sh', '-c', `rm -rf "${pathToRemove}"`],
      cwd: '/workspace',
    });
  }
}

