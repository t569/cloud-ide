// backend/src/services/FileSystemManager.ts
import { config } from '../config/env';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export class FileSystemManager {
  private apiUrl: string;

  constructor() {
    this.apiUrl = config.OPENSANDBOX_API_URL;
  }

  /**
   * Internal helper to execute shell commands securely inside the OpenSandbox container
   */
  private async execContainerCommand(sandboxId: string, cmd: string[]): Promise<string> {
    const response = await fetch(`${this.apiUrl}/api/sandbox/${sandboxId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd })
    });

    if (!response.ok) {
      throw new Error(`OpenSandbox Engine rejected command: ${response.statusText}`);
    }

    const data = await response.json();
    
    // OpenSandbox typically returns { code, stdout, stderr }
    if (data.code !== 0 && data.stderr) {
      throw new Error(`Container Error: ${data.stderr}`);
    }

    return data.stdout || '';
  }

  /**
   * Lists all files and directories in a given path
   */
  public async listDirectory(sandboxId: string, dirPath: string = '/workspace'): Promise<FileNode[]> {
    // Uses standard Linux 'ls' to format output as "filename|type" (e.g., "src|d" or "index.js|f")
    const shellScript = `ls -1p "${dirPath}" | awk '{if(substr($0,length($0),1)=="/") print substr($0,1,length($0)-1)"|d"; else print $0"|f"}'`;
    
    try {
      const output = await this.execContainerCommand(sandboxId, ['/bin/sh', '-c', shellScript]);
      
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
    const base64Output = await this.execContainerCommand(sandboxId, ['/bin/sh', '-c', `base64 "${filePath}"`]);
    return Buffer.from(base64Output.trim(), 'base64').toString('utf-8');
  }

  /**
   * Writes content to a file securely using Base64
   */
  public async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    // We encode the content in Node, send it as a single string, and decode it inside the container
    const b64Content = Buffer.from(content).toString('base64');
    
    // Ensure the parent directory exists first (mkdir -p)
    const dirName = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.execContainerCommand(sandboxId, ['/bin/sh', '-c', `mkdir -p "${dirName}"`]);

    // Write the file
    await this.execContainerCommand(sandboxId, ['/bin/sh', '-c', `echo "${b64Content}" | base64 -d > "${filePath}"`]);
  }

  /**
   * Deletes a file or directory
   */
  public async deletePath(sandboxId: string, pathToRemove: string): Promise<void> {
    // rm -rf safely removes files or recursively deletes folders
    await this.execContainerCommand(sandboxId, ['/bin/sh', '-c', `rm -rf "${pathToRemove}"`]);
  }
}