// terminal/core/InputManager.ts

// this is to handle special characters and input from the terminal input


// special characters like cntrl+C and cntrl+D trigger the SIGINT and EOF signals

import { ITransportStream } from '../types/terminal';

type SignalCallback = () => void;

export class InputManager {
  private signalListeners: Map<'SIGINT' | 'EOF', SignalCallback[]> = new Map();

  constructor() {
    this.signalListeners.set('SIGINT', []);
    this.signalListeners.set('EOF', []);
  }

  /**
   * Routes input from the terminal UI to either signal handlers or the transport layer.
   */
  public handleInput(data: string, transport: ITransportStream | null): void {
    // Intercept Ctrl+C (ASCII \x03)
    if (data === '\x03') {
      this.emitSignal('SIGINT');
      return;
    }

    // Intercept Ctrl+D (ASCII \x04)
    if (data === '\x04') {
      this.emitSignal('EOF');
      return;
    }

    // Standard typing: pass it straight to the transport layer (Docker or WASM)
    if (transport) {
      transport.write(data);
    }
  }

  /**
   * Writes selected text to the browser's clipboard.
   */
  public async handleCopy(text: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text to clipboard:', err);
    }
  }

  /**
   * Reads text from the browser's clipboard.
   */
  public async handlePaste(): Promise<string> {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (err) {
      console.error('Failed to read from clipboard:', err);
      return '';
    }
  }

  /**
   * Subscribes to specific terminal signals.
   */
  public onSignal(signal: 'SIGINT' | 'EOF', callback: SignalCallback): void {
    const listeners = this.signalListeners.get(signal);
    if (listeners) {
      listeners.push(callback);
    }
  }

  private emitSignal(signal: 'SIGINT' | 'EOF'): void {
    const listeners = this.signalListeners.get(signal);
    if (listeners) {
      listeners.forEach(cb => cb());
    }
  }
}