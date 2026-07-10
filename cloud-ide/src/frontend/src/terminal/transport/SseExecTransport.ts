// frontend/src/terminal/transport/SseExecTransport.ts
//
// The live replacement for the dev/mock transports (Step 4b): connects the
// terminal UI to the Gateway's real SSE execution stream.
//
// Line discipline mirrors DevTransport: keystrokes are echoed locally and
// buffered; on Enter the full line is POSTed to /exec and the SSE response
// (stdout/stderr events) is streamed back into the terminal.
//
// ponytail: line-mode, not a real PTY — no interactive programs (vim, top).
// Upgrade path: a WebSocket PTY bridge on the gateway when execd grows
// interactive session support.
import { API_BASE_URL } from '../../config/env';
import { postStream } from '../../lib/apiClient';
import { ITransportStream } from '../types/terminal';

const PROMPT = '/workspace $ ';

export class SseExecTransport implements ITransportStream {
  private lineBuffer = '';
  private running = false;
  private abortController: AbortController | null = null;

  private dataListeners: ((data: string) => void)[] = [];
  private errorListeners: ((error: Error) => void)[] = [];

  constructor(private sandboxId: string) {}

  public async connect(): Promise<void> {
    setTimeout(() => this.broadcast(`\r\n${PROMPT}`), 50);
  }

  public disconnect(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.dataListeners = [];
    this.errorListeners = [];
  }

  public write(data: string): void {
    // Ctrl+C: abort the in-flight command
    if (data === '\x03') {
      if (this.running) {
        this.abortController?.abort();
      } else {
        this.lineBuffer = '';
        this.broadcast(`^C\r\n${PROMPT}`);
      }
      return;
    }

    if (this.running) return; // ignore typing while a command streams

    if (data === '\x7f' || data === '\b') {
      if (this.lineBuffer.length > 0) {
        this.lineBuffer = this.lineBuffer.slice(0, -1);
        this.broadcast('\b \b');
      }
      return;
    }

    if (data === '\r') {
      this.broadcast('\r\n');
      const command = this.lineBuffer.trim();
      this.lineBuffer = '';

      if (!command) {
        this.broadcast(PROMPT);
        return;
      }

      void this.execute(command);
      return;
    }

    // Local echo for printable input (no PTY on the other side to echo for us)
    this.lineBuffer += data;
    this.broadcast(data);
  }

  public onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  public onError(callback: (error: Error) => void): void {
    this.errorListeners.push(callback);
  }

  private broadcast(data: string) {
    this.dataListeners.forEach((cb) => cb(data));
  }

  /**
   * POSTs the command to the Gateway and incrementally parses the SSE body,
   * writing stdout/stderr events straight into the terminal.
   */
  private async execute(command: string): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();

    try {
      // Send the raw command as a single element — do NOT wrap it in
      // ['/bin/sh','-c', command]. execd already runs the command through a shell
      // (`bash -c <string>`), and the gateway flattens this array with join(' ')
      // before handing it over. Wrapping produced `bash -c "/bin/sh -c <command>"`,
      // a triple-shell that syntax-errored on anything with a loop/pipe/quote and
      // streamed nothing back — the "terminal shows no output" bug.
      const response = await postStream(`${API_BASE_URL}/v1/sandboxes/${this.sandboxId}/exec`, {
        body: { command: [command], cwd: '/workspace' },
        signal: this.abortController.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Gateway returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? ''; // keep the trailing partial line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'stdout' || payload.type === 'stderr') {
              // Normalize bare \n to \r\n so xterm.js renders columns correctly
              const text: string = payload.text || payload.data || '';
              this.broadcast(text.replace(/(?<!\r)\n/g, '\r\n'));
            }
          } catch {
            // Ignore malformed partial chunks — same tolerance as the backend driver
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.broadcast('^C');
      } else {
        this.broadcast(`\r\n\x1b[31m${error.message}\x1b[0m`);
        this.errorListeners.forEach((cb) => cb(error));
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.broadcast(`\r\n${PROMPT}`);
    }
  }
}
