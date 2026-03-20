// backend/src/services/sandbox/drivers/opensandbox/OpenSandboxExecClient.ts


// this defines the exec daemon for executing code in open sandbox
import { EventEmitter } from 'events';
import * as http from 'http';

export interface ExecOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export class OpenSandboxExecClient extends EventEmitter {
  private ipAddress: string;
  private port: number;

  constructor(ipAddress: string, port: number = 44772) {
    super();
    this.ipAddress = ipAddress;
    this.port = port;
  }

  /**
   * Initiates a command and streams the result via events.
   */
  public run(options: ExecOptions): void {
    const payload = JSON.stringify({
      cmd: ['bash', '-c', options.command],
      cwd: options.cwd || '/workspace',
      env: options.env || {}
    });

    const req = http.request(
      {
        hostname: this.ipAddress,
        port: this.port,
        path: '/exec', // The standard execd endpoint
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        // execd typically returns a multiplexed stream or a standard text stream.
        // We listen to the chunks and emit them.
        res.on('data', (chunk: Buffer) => {
          // In a production environment, you might need to parse multiplexed headers here 
          // (e.g., Docker's 8-byte header separating stdout from stderr).
          // Assuming a standard text stream for this abstraction:
          this.emit('stdout', chunk.toString('utf-8'));
        });

        res.on('end', () => {
          // Pass back the HTTP status code as the exit code (or parse it from the body if execd sends it)
          const exitCode = res.statusCode === 200 ? 0 : 1;
          this.emit('exit', exitCode);
        });
      }
    );

    req.on('error', (err) => {
      this.emit('error', err);
    });

    req.write(payload);
    req.end();
  }
}