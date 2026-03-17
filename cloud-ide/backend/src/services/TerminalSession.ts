import * as pty from 'node-pty';
import { spawn } from 'node:child_process'; // node prefix is so that the imports work
import { randomBytes } from 'node:crypto';

export class TerminalSession {
  private ptyProcess: pty.IPty;
  private containerName: string;
  
 
  private onDataCallback?: (data: string) => void;

  constructor(imageName: string, cols: number = 80, rows: number = 24) {

    // Generate a unique ID so we can hunt this specific container down later
    const sessionId = randomBytes(4).toString('hex');
    this.containerName = `cloud-ide-run-${sessionId}`;


    // We spawn the Docker container directly as the pseudoterminal process.
    // The '--rm' flag ensures the container is destroyed when the session ends.
    this.ptyProcess = pty.spawn('docker', [
      'run', '-it', '--rm', 
      '--name', this.containerName, // Explicitly name the container
      '-e', 'TERM=xterm-256color', 
      imageName, 
      'bash'
    ], {
      name: 'xterm-256color',
      cols: cols,
      rows: rows,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string }
    });
  

    // Capture the stdout/stderr stream from the shell

    // runs all the call backs to handle that data
    // pty Process onData method automatically captures the data
    // now we passthe callback to the pty process
    // TODO: find if we can pass multiple callbacks
    this.ptyProcess.onData((data: string) => {
      if (this.onDataCallback) {
        this.onDataCallback(data);
      }
    });
  }



  // IMPORTANT UTILITIES

  /**
   * Registers a callback to receive data emitted by the terminal.
   * This is how the WebSocketManager listens without being tightly coupled.
   */


  // this runs to register a function to execute every time we parse datas
 /**
   * Delegates the callback directly to the native pty event emitter.
   */
  public onData(callback: (data: string) => void): void {
    this.ptyProcess.onData(callback);
  }

  /**
   * Writes raw input (keystrokes) into the terminal process.
   */
  public write(data: string): void {
    this.ptyProcess.write(data);
  }

  /**
   * Resizes the terminal matrix to prevent text wrapping issues when the browser resizes.
   */
  public resize(cols: number, rows: number): void {
    try {
      this.ptyProcess.resize(cols, rows);
    } catch (err) {
      console.error('Failed to resize pty:', err);
    }
  }

  /**
   * Safely kills the underlying process and cleans up memory.
   */

  // SERIOUS TODO: we have to refactor this such that when we kill the function we also kill the container if need be
 public kill(): void {
    try {
      // 1. Kill the local terminal wrapper
      this.ptyProcess.kill();
      
      // 2. Force-kill the actual Docker container to prevent memory leaks
      const cleanup = spawn('docker', ['rm', '-f', this.containerName]);
      cleanup.on('close', (code) => {
        console.log(`Container ${this.containerName} securely destroyed (code ${code}).`);
      });
    } catch (err) {
      console.error('Failed to kill pty process:', err);
    }
  }
}