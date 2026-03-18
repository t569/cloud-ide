// frontend/src/terminal/transport/SessionStream.ts

// this defines the stream we need to talk to the backend session
// we are sending JSON packets of either data (stuff typed in the  terminal), or commands e.g. resize
// the server for this is in backend/src/server.ts
// 

import { ITransportStream } from '../types/terminal';
import { WS_BASE_URL } from '../../config/env';


export class SessionStream implements ITransportStream {
  private socket: WebSocket | null = null;
  private sessionId: string;
  private envId: string;
  private repoUrl: string;
  
  // Callbacks to pass data and errors back up to the terminal UI
  private onDataCallback?: (data: string) => void;
  private onErrorCallback?: (error: Error) => void;

  constructor(sessionId: string, envId: string, repoUrl: string) {
    this.sessionId = sessionId;
    this.envId = envId;
    this.repoUrl = repoUrl;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Construct the URL dynamically based on the session parameters
        const params = new URLSearchParams({
          sessionId: this.sessionId,
          env: this.envId,
          repo: this.repoUrl
        });

        // 1. Clean, centralized URL construction
        const wsUrl = `${WS_BASE_URL}?${params.toString()}`;
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log(`[SessionStream] Connected to container at ${wsUrl}`);
          resolve();
        };

        this.socket.onmessage = (event) => {
          // When the Node server (node-pty) sends text, trigger the callback
          if (this.onDataCallback) {
            this.onDataCallback(event.data.toString());
          }
        };

        this.socket.onerror = (error) => {
          console.error('[SessionStream] WebSocket Error:', error);
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error('WebSocket connection error'));
          }
          reject(error);
        };

        this.socket.onclose = () => {
          console.log(`[SessionStream] Disconnected from process ${this.sessionId}`);
        };

      } catch (err) {
        reject(err);
      }
    });
  }

  public disconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  /**
   * Writes raw keystrokes over the socket directly to node-pty.
   */
  public write(data: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'data', payload: data }));
    }
  }

  /**
   * Tells the backend to resize the shell matrix.
   */
  public resize(cols: number, rows: number): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  public onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  public onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
}
