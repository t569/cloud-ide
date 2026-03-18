// backend/src/core/Session.ts
import { WebSocket } from 'ws';
import { Container } from './Container';
import { IDisposable } from 'node-pty';

export class Session {
  private container: Container | null = null;
  private activeSocket: WebSocket | null = null;
  private dataListener: IDisposable | null = null; 

  constructor(public readonly sessionId: string) {}

  /**
   * Links this I/O stream to a specific hardware execution thread.
   */
  public coupleContainer(container: Container): void {
    this.container = container;
  }

  /**
   * Routes the container's output to the connected WebSocket.
   * Seamlessly handles stream hijacking if a previous socket was active.
   */
  public attachStream(ws: WebSocket): void {
    // 1. Terminate the old socket if a new one is hijacking the stream
    if (this.activeSocket && this.activeSocket !== ws) {
      this.activeSocket.close();
    }
    this.activeSocket = ws;

    // 2. Prevent Memory Leaks: Destroy the old event listener
    if (this.dataListener) {
      this.dataListener.dispose();
    }

    const ptyProcess = this.container?.getPtyProcess();
    if (!ptyProcess) return;

    // 3. Attach the new listener and save the reference for future garbage collection
    this.dataListener = ptyProcess.onData((data: string) => {
      if (this.activeSocket?.readyState === WebSocket.OPEN) {
        this.activeSocket.send(data);
      }
    });
  }

  /**
   * Pipes frontend keystrokes down into the execution thread.
   */
  public write(data: string): void {
    if (this.container) {
      this.container.write(data);
    }
  }
  /**
   * Forwards the terminal dimensions to the attached Docker container.
   */
  public resize(cols: number, rows: number): void {
    if (this.container) {
      this.container.resize(cols, rows);
    } else {
      console.warn(`[Session ${this.sessionId}] Cannot resize: No container attached.`);
    }
  }

  public getContainer(): Container | null {
    return this.container;
  }
}