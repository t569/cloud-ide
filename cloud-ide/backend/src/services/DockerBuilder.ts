import { spawn } from 'child_process';
import { WebSocket } from 'ws';

// TO MIGRATE
export class DockerBuilder {
  private envName: string;
  private dockerfileContent: string;
  private imageName: string;

  constructor(envName: string, dockerfileContent: string) {
    // Sanitize the environment name to ensure it's a valid Docker image tag
    this.envName = envName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.dockerfileContent = dockerfileContent;
    
    // Tag the image predictably so the TerminalSession can find it later
    this.imageName = `cloud-ide-${this.envName}:latest`;
  }

  /**
   * Spawns the Docker build process, pipes in the IaC configuration via stdin,
   * and streams the compilation logs back over the WebSocket to the frontend.
   */
  public async buildAndStreamLogs(ws: WebSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      
      this.safeSend(ws, `\r\n\x1b[1;34m[Infrastructure]\x1b[0m Initializing build for environment '${this.envName}'...\r\n`);

      // Spawn the Docker process. 
      // The '-' tells Docker to read the Dockerfile instructions from stdin instead of a file path.
      const buildProcess = spawn('docker', ['build', '-t', this.imageName, '-']);

      // Inject our compiled Dockerfile string directly into the process pipeline
      buildProcess.stdin.write(this.dockerfileContent);
      buildProcess.stdin.end();

      // Stream Standard Output to the IDE Terminal
      buildProcess.stdout.on('data', (data: Buffer) => {
        // xterm.js requires carriage returns (\r\n) to render new lines properly
        // TODO: might we need to recfactor this to be an abstraction?
        const formatted = data.toString().replace(/\n/g, '\r\n');
        this.safeSend(ws, formatted);
      });

      // Stream Standard Error (Docker routes most build step logs through stderr)
      buildProcess.stderr.on('data', (data: Buffer) => {
        const formatted = data.toString().replace(/\n/g, '\r\n');
        // Wrap in yellow ANSI codes so the user knows it's a build step/warning
        this.safeSend(ws, `\x1b[33m${formatted}\x1b[0m`); 
      });

      // Catch process termination
      buildProcess.on('close', (code) => {
        if (code === 0) {
          this.safeSend(ws, `\r\n\x1b[1;32m[Infrastructure]\x1b[0m Compilation successful. Image tagged as ${this.imageName}.\r\n\n`);
          resolve(this.imageName);
        } else {
          const errMsg = `Docker daemon exited with code ${code}`;
          this.safeSend(ws, `\r\n\x1b[1;31m[Build Error]\x1b[0m ${errMsg}\r\n`);
          reject(new Error(errMsg));
        }
      });

      // Catch OS-level execution failures (e.g., Docker is not installed or running)
      buildProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn Docker process. Is the daemon running? Details: ${err.message}`));
      });
    });
  }

  /**
   * Helper to ensure we don't write to a closed socket if the user drops connection mid-build.
   */
  private safeSend(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}