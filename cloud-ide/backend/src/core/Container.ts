// backend/src/core/Container.ts
import { spawn } from 'node:child_process';
import * as pty from 'node-pty';

export class Container {
  public readonly containerId: string;
  public isLive: boolean = false;
  
  // The raw OS-level terminal stream
  private ptyProcess: pty.IPty | null = null;

  constructor(sessionId: string, private imageName: string) {
    // Deterministic naming: Tightly couples the OS process to the User ID
    this.containerId = `ide-exec-${sessionId}`;
  }

  /**
   * Cold Boot: Spawns a brand new container and physically mounts the file system.
   */
  public createAndRun(mountPath: string): pty.IPty {
    this.isLive = true; 
    
    this.ptyProcess = pty.spawn('docker', [
      'run', '-it', 
      '--name', this.containerId,
      '-v', `${mountPath}:/workspace`, // Physical volume mount
      '-w', '/workspace',
      this.imageName, 'bash'
    ], { name: 'xterm-256color', cols: 80, rows: 24 });

    return this.ptyProcess;
  }

  /**
   * Warm Boot: Wakes up a sleeping container. 
   * Docker inherently remembers the volume mount from the cold boot.
   */
  public wakeUp(): pty.IPty {
    this.isLive = true;

    // 'start -i' attaches our terminal directly to the waking process
    this.ptyProcess = pty.spawn('docker', [
      'start', '-i', this.containerId
    ], { name: 'xterm-256color', cols: 80, rows: 24 });

    return this.ptyProcess;
  }

  /**
   * Pauses execution but preserves the hard drive state and volume mounts.
   */
  public stop(): void {
    if (this.isLive) {
      this.killLocalProcess();
      spawn('docker', ['stop', this.containerId]);
      this.isLive = false;
    }
  }

  /**
   * Violently assassinates the container and wipes its ephemeral memory.
   */
  public destroy(): void {
    this.killLocalProcess();
    spawn('docker', ['rm', '-f', this.containerId]);
    this.isLive = false;
  }

  /**
   * Exposes the PTY process so the Session class can hijack the stream.
   */
  public getPtyProcess(): pty.IPty | null {
    return this.ptyProcess;
  }

  public write(data: string): void {
    if (this.ptyProcess) this.ptyProcess.write(data);
  }

  // Helper to prevent memory leaks by destroying the Node.js wrapper
  private killLocalProcess(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }
}