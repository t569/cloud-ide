import * as pty from 'node-pty';

export class TerminalSession {
  private ptyProcess: pty.IPty;
  private onDataCallback?: (data: string) => void;

  constructor(imageName: string, cols: number = 80, rows: number = 24) {
    // We spawn the Docker container directly as the pseudoterminal process.
    // The '--rm' flag ensures the container is destroyed when the session ends.
    this.ptyProcess = pty.spawn('docker', [
      'run', '-it', '--rm', 
      '-e', 'TERM=xterm-256color', // Tells the Linux shell exactly how to render colors
      imageName, 
      'bash'
    ], {
      name: 'xterm-256color',
      cols: cols,
      rows: rows,
    });

    // Capture the stdout/stderr stream from the shell

    // runs all the call backs to handle that data
    // pty Process onData method automatically captures the data
    
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
  public onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
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
  public kill(): void {
    try {
      this.ptyProcess.kill();
    } catch (err) {
      console.error('Failed to kill pty process:', err);
    }
  }
}