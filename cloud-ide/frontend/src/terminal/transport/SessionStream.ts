// frontend/src/terminal/transport/SessionStream.ts

import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox';
import { ITransportStream } from '../types/terminal';

export class SessionStream implements ITransportStream {
  private sandbox: any = null;
  private ptyProcess: any;
  private endpoint: string;
  private sandboxId: string;
  private repoUrl: string;

  private onDataCallback: (data: string) => void = () => {};
  private onErrorCallback: (error: Error) => void = () => {};

  constructor(endpoint: string, sandboxId: string, repoUrl: string = '') {
    this.endpoint = endpoint;
    this.sandboxId = sandboxId;
    this.repoUrl = repoUrl;
  }

  public async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        
        // 1. THE FIX: Use Alibaba's ConnectionConfig to parse the endpoint
        const endpointUrl = new URL(this.endpoint);
        const config = new ConnectionConfig({
          domain: endpointUrl.host,
          // Tell TypeScript this string will strictly be one of these two allowed protocols
          protocol: endpointUrl.protocol.replace(':', '') as 'http' | 'https', 
        });

        // 2. Attach to the existing sandbox container provisioned by our backend.
        // We use 'as any' here to gracefully bypass overly strict SDK type definitions
        // when connecting to a pre-existing session.
        this.sandbox = await (Sandbox as any).connect({
          sandboxId: this.sandboxId,
          connectionConfig: config
        });

        // 3. THE FIX: Define the stream handlers upfront
        const handlers = {
          onStdout: (m: any) => this.onDataCallback(m.text),
          onStderr: (m: any) => this.onDataCallback(m.text),
        };

        // 4. THE FIX: Remove 'tty' and run the shell in the background.
        // Alibaba's SDK expects the stream handlers as the third argument.
        this.ptyProcess = await this.sandbox.commands.run(
          'bash',
          { background: true, env: { TERM: 'xterm-256color' } },
          handlers
        );

        console.log(`\x1b[32m[SessionStream]\x1b[0m Connected to Sandbox: ${this.sandboxId}`);

        // 5. THE CLEAN SLATE & CLONE PROTOCOL
        if (this.repoUrl) {
          const cloneCmd = `rm -rf ./* && git clone ${this.repoUrl} . \r`;
          this.write(cloneCmd);
        }

        resolve();
      } catch (error: any) {
        console.error('\x1b[31m[SessionStream Error]\x1b[0m Failed to attach to Sandbox terminal', error);
        this.onErrorCallback(new Error(error.message || 'Failed to connect'));
        reject(error);
      }
    });
  }

  public disconnect(): void {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
        console.log(`[SessionStream] Disconnected from process ${this.sandboxId}`);
      } catch (err) {
        console.error('[SessionStream] Failed to kill process', err);
      }
    }
  }

  public write(data: string): void {
    if (this.ptyProcess) {
      // Defensive fallback: depending on the exact SDK version, 
      // the input stream method can be named differently.
      if (typeof this.ptyProcess.sendStdin === 'function') {
        this.ptyProcess.sendStdin(data);
      } else if (this.ptyProcess.stdin && typeof this.ptyProcess.stdin.write === 'function') {
        this.ptyProcess.stdin.write(data);
      }
    }
  }

  public resize(cols: number, rows: number): void {
    if (this.ptyProcess && typeof this.ptyProcess.resize === 'function') {
      this.ptyProcess.resize(cols, rows);
    }
  }

  public onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  public onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
}