// frontedn/src/terminal/WebScoketTransport.ts

import { ITransportStream } from "../types/terminal";

export class WebSocketTransport implements ITransportStream {
    private ws: WebSocket | null = null;
    private url: string;


    // Callbacks
    private dataListeners: ((data: string) => void)[] = [];
    private errorListeners: ((error: Error) => void)[] = [];

    // Reconnection State
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isIntentionalDisconnect = false;

    constructor(url: string) {
        this.url = url;
    }

    /**
     * Establishes the WebScoket connection to the backend container
     */
    public connect(): Promise<void> {
        this.isIntentionalDisconnect = false;

        return new Promise((resolve, reject) => {

            try {
                this.ws = new WebSocket(this.url);

                // Tell the browser to give us raw binary data, which is standard for PTY
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    console.log(`[WebSocketTransport] Connected to ${this.url}`);
                    this.reconnectAttempts = 0;     // Reset the counter on success
                    resolve();
                };

                this.ws.onmessage = (event) => this.handleIncomingMessage(event);

                // handle the error
                this.ws.onerror = (event) => {
                    const error = new Error('WebSocket connection error');
                    this.errorListeners.forEach(cb => cb(error));
                    // If we haven't resolved the initial connection promise yet, reject it
                    if (this.ws?.readyState !== WebSocket.OPEN) {
                        reject(error);
                    }
                };

                this.ws.onclose = () => this.handleClose();
            
            }catch(error) {
                reject(error);
            } 
        });
    }


   /**
   * Gracefully closes the connection.
   */
   public disconnect(): void {
        this.isIntentionalDisconnect = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
            this.dataListeners = [];
            this.errorListeners = [];
    }

    /**
     * Writes data from the frontend to the backend PTY.
     */
    public write(data: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        } else {
            console.warn('[WebSocketTransport] Attempted to write to a closed WebSocket.');
        }
    }


    /**
     * Sends a control message to resize the backend PTY.
     * Note: This assumes your backend expects a JSON payload for resizing.
     */
    public resize(cols: number, rows: number): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Industry standard multiplexing: Send a JSON string formatted as a resize command
            const resizePayload = JSON.stringify({ type: 'resize', cols, rows });
            this.ws.send(resizePayload);
        }
    }

    public onData(callback: (data: string) => void): void {
        this.dataListeners.push(callback);
    }

    public onError(callback: (error: Error) => void): void {
        this.errorListeners.push(callback);
    }


    // --- PRIVATE METHODS ---

    /**
     * Handles raw incoming messages from the WebSocket.
     */
    private handleIncomingMessage(event: MessageEvent): void {
        let dataStr = '';

        if (typeof event.data === 'string') {
            dataStr = event.data;
        } else if (event.data instanceof ArrayBuffer) {
            // Convert raw bytes from the Linux PTY into a readable string for xterm.js
            dataStr = new TextDecoder().decode(event.data);
        }

        this.dataListeners.forEach(cb => cb(dataStr));
    }

    /**
     * Handles unexpected drops and triggers exponential backoff reconnection.
     */
    private handleClose(): void {
        if (this.isIntentionalDisconnect) {
            console.log('[WebSocketTransport] Disconnected intentionally.');
            return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const timeout = Math.pow(2, this.reconnectAttempts) * 1000; // 1s, 2s, 4s, 8s...
            console.warn(`[WebSocketTransport] Connection lost. Reconnecting in ${timeout}ms...`);
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect().catch(() => {
                // If the reconnect fails, the onclose event will fire again, looping this logic
                console.error(`[WebSocketTransport] Reconnection attempt ${this.reconnectAttempts} failed.`);
                });
            }, timeout);
        
        } else {
            console.error('[WebSocketTransport] Max reconnection attempts reached. Terminal is dead.');
            this.errorListeners.forEach(cb => cb(new Error('Connection lost permanently.')));
        }
    }



}