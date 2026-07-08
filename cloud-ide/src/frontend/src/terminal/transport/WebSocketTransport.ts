// frontend/src/terminal/transport/WebSocketTransport.ts
//
// Interactive PTY transport (Phase 2 — see backend/TERMINAL_BACKEND.md).
// Wire protocol, disambiguated by FRAME TYPE (not a tag field):
//   • binary frame = raw stdin/stdout bytes — a real TTY (vim, top, colors).
//   • text frame   = JSON control message, e.g. {type:'resize',cols,rows}.
// The backend /pty bridge mirrors this: binary ⇒ PTY stdin, text ⇒ control.

import { ITransportStream } from "../types/terminal";

interface TerminalSize { cols: number; rows: number; }

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

    // Last known size, re-sent on every (re)connect so the PTY starts — and stays
    // after a reconnect — correctly sized. Seeded from the optional ctor arg.
    private lastSize: TerminalSize | null = null;

    // Streaming decoder: PTY output is binary and a multi-byte UTF-8 char can
    // straddle two frames — {stream:true} stitches it instead of mangling it.
    private decoder = new TextDecoder();
    private encoder = new TextEncoder();

    constructor(url: string, initialSize?: TerminalSize) {
        this.url = url;
        this.lastSize = initialSize ?? null;
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
                    // Re-sync the PTY size on connect / reconnect (if known).
                    if (this.lastSize) this.sendControl({ type: 'resize', ...this.lastSize });
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
     * Writes stdin to the backend PTY as a BINARY frame (UTF-8 bytes), so raw
     * keystrokes can never be confused with a text/JSON control message.
     */
    public write(data: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(this.encoder.encode(data));
        } else {
            console.warn('[WebSocketTransport] Attempted to write to a closed WebSocket.');
        }
    }


    /**
     * Resizes the backend PTY. Sent as a TEXT (JSON) control frame, and
     * remembered so a reconnect re-syncs the size automatically.
     */
    public resize(cols: number, rows: number): void {
        this.lastSize = { cols, rows };
        this.sendControl({ type: 'resize', cols, rows });
    }

    /** Send a JSON control message as a TEXT frame. The backend reads text
     *  frames as control and binary frames as stdin. No-op if the socket is down. */
    private sendControl(message: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
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
            dataStr = event.data; // text frame — control/echo (rare inbound)
        } else if (event.data instanceof ArrayBuffer) {
            // Raw PTY bytes → string; stream:true keeps multi-byte UTF-8 intact
            // when a character straddles two frames.
            dataStr = this.decoder.decode(event.data, { stream: true });
        }

        if (dataStr) this.dataListeners.forEach(cb => cb(dataStr));
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