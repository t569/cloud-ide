import { EventEmitter } from 'node:events';
import { config } from '../../../../config/env';

export interface OpenSandboxExecRunOptions {
  command: string | string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class OpenSandboxExecClient {
  constructor(
    private ipAddress: string,
    private execdPort: number
  ) {}

  public run(options: OpenSandboxExecRunOptions): EventEmitter {
    const stream = new EventEmitter();
    const command = Array.isArray(options.command)
      ? options.command
      : ['/bin/sh', '-lc', options.command];

    void (async () => {
      try {
        const response = await fetch(`http://${this.ipAddress}:${this.execdPort}/command`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            ...(config.OPENSANDBOX_EXECD_ACCESS_TOKEN
              ? { 'X-EXECD-ACCESS-TOKEN': config.OPENSANDBOX_EXECD_ACCESS_TOKEN }
              : {}),
          },
          body: JSON.stringify({
            command,
            cwd: options.cwd || '/workspace',
            env: options.env || {},
          }),
        });

        if (!response.ok) {
          throw new Error(`execd rejected command: ${response.status} ${response.statusText}`);
        }

        const body = await response.text();
        let exitCode = 0;

        for (const line of body.split('\n')) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'stdout') {
              stream.emit('stdout', Buffer.from(payload.text || payload.data || ''));
            } else if (payload.type === 'stderr') {
              stream.emit('stderr', Buffer.from(payload.text || payload.data || ''));
            } else if (payload.type === 'result') {
              exitCode = payload.exitCode ?? payload.code ?? 0;
            }
          } catch {
            // Ignore malformed partial chunks from compatibility parsing.
          }
        }

        stream.emit('exit', exitCode);
      } catch (error) {
        stream.emit('error', error);
      }
    })();

    return stream;
  }
}
