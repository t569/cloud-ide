// backend/src/services/DockerBuilder.ts


// refactored to stream on http now

import { spawn } from 'child_process';
import { Response } from 'express';

export class DockerBuilder {
  private envName: string;
  private dockerfileContent: string;
  public imageName: string; // Made public so your controller can access it

  constructor(envName: string, dockerfileContent: string) {
    this.envName = envName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.dockerfileContent = dockerfileContent;
    this.imageName = `cloud-ide-${this.envName}:latest`;
  }

  /**
   * Spawns the Docker build process and streams logs via HTTP Chunked Transfer
   */
  public async buildAndStreamLogs(res: Response): Promise<string> {
    return new Promise((resolve, reject) => {
      
      // We use res.write() to stream chunks without closing the HTTP connection
      res.write(`\r\n\x1b[1;34m[Infrastructure]\x1b[0m Initializing build for environment '${this.envName}'...\r\n`);

      const buildProcess = spawn('docker', ['build', '-t', this.imageName, '-']);

      buildProcess.stdin.write(this.dockerfileContent);
      buildProcess.stdin.end();

      buildProcess.stdout.on('data', (data: Buffer) => {
        const formatted = data.toString().replace(/\n/g, '\r\n');
        res.write(formatted);
      });

      buildProcess.stderr.on('data', (data: Buffer) => {
        const formatted = data.toString().replace(/\n/g, '\r\n');
        res.write(`\x1b[33m${formatted}\x1b[0m`); 
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          res.write(`\r\n\x1b[1;32m[Infrastructure]\x1b[0m Compilation successful. Image tagged as ${this.imageName}.\r\n\n`);
          resolve(this.imageName);
        } else {
          const errMsg = `Docker daemon exited with code ${code}`;
          res.write(`\r\n\x1b[1;31m[Build Error]\x1b[0m ${errMsg}\r\n`);
          reject(new Error(errMsg));
        }
      });

      buildProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn Docker process: ${err.message}`));
      });
    });
  }
}