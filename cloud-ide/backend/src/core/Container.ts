
/*      backend/src/core/Container.ts
*/

import { spawn } from 'node:child_process';
import * as pty from 'node-pty';

export class Container {
  public containerId: string;
  public isLive: boolean = false; // Tracks if the process is currently running [cite: 5]

  constructor(private imageName: string, private envConfig: any) {
    // Generates a unique Docker container name
    this.containerId = `ide-exec-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Boots the container and attaches the pseudo-terminal.
   */
  public run(mountPath: string): pty.IPty {
    this.isLive = true; // Set live field to true [cite: 5]
    
    // Notice the -v flag! This mounts our backend folder into the container's /workspace
    return pty.spawn('docker', [
      'run', '-it', 
      '--name', this.containerId,
      '-v', `${mountPath}:/workspace`, 
      '-w', '/workspace',
      this.imageName, 'bash'
    ], { name: 'xterm-256color', cols: 80, rows: 24 });
  }

  /**
   * Option B: Stop the container but persist its data [cite: 4]
   */
  public stop(): void {
    if (this.isLive) {
      spawn('docker', ['stop', this.containerId]);
      this.isLive = false;
    }
  }

  /**
   * Option A: Destroy container entirely 
   */
  public destroy(): void {
    spawn('docker', ['rm', '-f', this.containerId]);
    this.isLive = false;
  }
}