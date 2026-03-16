import { ITransportStream } from '../types/terminal';

export class DockerStream implements ITransportStream {
  private socket: WebSocket | null = null;
  private url: string;
  
  // Callbacks to pass data and errors back up to the terminal UI
  private onDataCallback?: (data: string) => void;
  private onErrorCallback?: (error: Error) => void;

  constructor(wsUrl: string) {
    this.url = wsUrl;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          console.log(`Connected to Docker container at ${this.url}`);
          resolve();
        };

        this.socket.onmessage = (event) => {
          // When the Node server (node-pty) sends text, trigger the callback
          if (this.onDataCallback) {
            this.onDataCallback(event.data.toString());
          }
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket Error:', error);
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error('WebSocket connection error'));
          }
          reject(error);
        };

        this.socket.onclose = () => {
          console.log('Disconnected from Docker container');
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
   * Writes raw keystrokes over the socket to node-pty.
   */
  public write(data: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // We wrap the standard data in a simple JSON payload so the Node server 
      // can distinguish between typing and resize commands.
      this.socket.send(JSON.stringify({ type: 'data', payload: data }));
    }
  }

  /**
   * Tells node-pty to resize the shell matrix.
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