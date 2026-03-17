
/*
        backend/src/core/Session.ts
*/
import { WebSocket } from 'ws';
import { Container } from './Container';

export class Session {
  public readonly sessionId: string;
  private container: Container | null = null;
  private activeSocket: WebSocket | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Couples this session to a specific container [cite: 5]
   */
  public coupleContainer(container: Container): void {
    this.container = container;
  }

  /**
   * Sets up the communication stream [cite: 6]
   * If a stream already exists, this allows a new socket to "hijack" it 
   */

  // this is useful in scheduling algorithms
  public attachStream(ws: WebSocket, ptyProcess: any): void {
    // If someone else is connected, disconnect them (Stream Hijacking)
    if (this.activeSocket && this.activeSocket !== ws) {
      this.activeSocket.close();
    }
    
    this.activeSocket = ws;

    // Route PTY output to the new socket
    ptyProcess.onData((data: string) => {
      if (this.activeSocket?.readyState === WebSocket.OPEN) {
        this.activeSocket.send(data);
      }
    });
  }

  public getContainer(): Container | null {
    return this.container;
  }
}