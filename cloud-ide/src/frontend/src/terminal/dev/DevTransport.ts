// frontend/src/terminal/dev/DevTransport.ts
import { ITransportStream } from '../types/terminal';

export class DevTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];
  private currentLineBuffer: string = ''; // Keep track of the current line for backend processing

  async connect(): Promise<void> {
    console.log('[DevTransport] Connected');
    setTimeout(() => this.broadcast('\r\n~/cloud-ide $ '), 100);
  }

  disconnect(): void {
    console.log('[DevTransport] Disconnected');
    this.dataListeners = [];
  }

  onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    // Handle errors
  }

  // Helper to send data back to xterm.js
  private broadcast(data: string) {
    this.dataListeners.forEach(cb => cb(data));
  }

  write(data: string): void {
    // 1. Handle Backspace (\x7f or \b)
    if (data === '\x7f' || data === '\b') {
      if (this.currentLineBuffer.length > 0) {
        // Remove last character from our internal buffer
        this.currentLineBuffer = this.currentLineBuffer.slice(0, -1);
        // Tell xterm.js to visually erase it: Backspace, Space, Backspace
        this.broadcast('\b \b'); 
      }
      return;
    }

    // 2. Handle Enter (\r)
    if (data === '\r') {
      this.broadcast('\r\n'); // Move terminal to next line
      
      const command = this.currentLineBuffer.trim();
      this.currentLineBuffer = ''; // Reset buffer

      // Simulate backend execution delay
      setTimeout(() => {
        if (command) {
          this.broadcast(`Executed: ${command}\r\n`);
        }
        this.broadcast('~/cloud-ide $ '); // Prompt again
      }, 200);
      
      return;
    }

    // 3. Handle standard typing (Local Echo)
    this.currentLineBuffer += data;
    this.broadcast(data); // Echo the character so the user sees it
  }
}