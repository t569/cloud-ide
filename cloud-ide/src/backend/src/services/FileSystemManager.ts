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

  // TODO: stream errors back to 
  // A. the user for stderr
  // B. backend errors to server.ts
  /**
   * Internal helper to execute shell commands securely inside the OpenSandbox container
   */

  // ERROR: we are routing to the wrong endpoint
 private async execContainerCommand(sandboxId: string, cmd: string[]): Promise<string> {
    
    const baseUrl = this.apiUrl.replace(/\/$/, '');

    // 1. Ask the Lifecycle API where the execd daemon is physically mapped
    const endpointRes = await fetch(`${baseUrl}/sandboxes/${sandboxId}/endpoints/44772`);
    
    if (!endpointRes.ok) {
      const serverErr = await endpointRes.text();
      throw new Error(`Failed to map execd endpoint: ${endpointRes.status} - ${serverErr}`);
    }
    
    const { endpoint } = await endpointRes.json(); 
    const execdUrl = endpoint.startsWith('http') ? endpoint : `http://${endpoint}`;

    // 2. Fire the command directly at the execd daemon
    const response = await fetch(`${execdUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }) 
    });

    if (!response.ok) {
      const serverErr = await response.text();
      throw new Error(`execd daemon rejected command: ${response.status} - ${serverErr}`);
    }

    // 3. Parse the Server-Sent Events (SSE) stream
    const text = await response.text();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const eventData = JSON.parse(line.substring(6));
          
          if (eventData.type === 'stdout') {
            stdout += eventData.text || eventData.data || '';
          } else if (eventData.type === 'stderr') {
            stderr += eventData.text || eventData.data || '';
          } else if (eventData.type === 'result') {
            // Grab the exit code when the command finishes
            exitCode = eventData.exitCode ?? eventData.code ?? 0;
          }
        } catch (e) {
          // Silently ignore incomplete JSON chunks
        }
      }
    }

    // 4. Pass stderr back to the server.ts router if the command failed
    if (exitCode !== 0) {
      throw new Error(`Container Command Failed (Code ${exitCode}):\n${stderr || 'Unknown Error'}`);
    }

    return stdout.trim();
  }
  // private async execContainerCommand(sandboxId: string, cmd: string[]): Promise<string> {
  //   // this is the port responsible for running commands
  //   const response = await fetch(`${this.apiUrl}/api/sandboxes/${sandboxId}/endpoints/44772`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ 
  //       command: cmd,
  //       // tty: false, // Prevents the engine from hanging while waiting for interactive input
  //      })
  //   });

  //   if (!response.ok) {
  //     throw new Error(`OpenSandbox Engine rejected command: ${response.statusText}`);
  //   }

  //   // 3. The STREAM FIX: OpenSandbox returns Server-Sent Events, not JSON!
  //   // Because our VFS commands (ls, base64, rm) execute instantly and exit, 
  //   // we can safely await the full text block and parse the SSE chunks.
  //   const text = await response.text();
  //   let stdout = '';


  //   const lines = text.split('\n');
  //   for (const line of lines) {
  //     if (line.startsWith('data: ')) {
  //       try {
  //         const eventData = JSON.parse(line.substring(6));
          
  //         // OpenSandbox categorizes stream chunks by 'type'
  //         if (eventData.type === 'stdout') {
  //            // Fallback to .data if .text isn't present depending on engine version
  //           stdout += eventData.text || eventData.data || '';
  //         } else if (eventData.type === 'stderr') {
  //           console.error(`[Container Stderr]`, eventData.text || eventData.data);
  //         }
  //       } catch (e) {
  //         // Silently ignore incomplete JSON chunks
  //       }
  //     }
  //   }

  //   return stdout.trim();
  // }

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