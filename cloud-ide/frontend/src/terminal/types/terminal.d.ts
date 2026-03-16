// terminal/types/terminal.d.ts

/**
 * Handles communication to and from an execution environment 
 * (either Docker backend or local WASM REPL).
 */
export interface ITransportStream {
  connect(): Promise<void>;
  disconnect(): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  onError(callback: (error: Error) => void): void;
}

/**
 * Processes and sanitizes data before it hits the terminal or backend.
 * Perfect for intercepting and fixing the Windows 24-line clear bug[cite: 2].
 */
export interface ITerminalMiddleware {
  processIncoming(data: string): string; 
  processOutgoing(data: string): string;
}

/**
 * Manages user keystrokes, clipboard actions, and OS-level signals.
 */
export interface IInputHandler {
  handleInput(data: string, transport: ITransportStream): void;
  handleCopy(text: string): Promise<void>;
  handlePaste(): Promise<string>;
  onSignal(signal: 'SIGINT' | 'EOF', callback: () => void): void; // Ctrl+C, Ctrl+D 
}

/**
 * Configuration options for the Terminal UI instance.
 */
export interface ITerminalConfig {
  theme?: 'linux' | 'dark' | 'light'; // Support for Linux terminal colors [cite: 2]
  fontFamily?: string;
  fontSize?: number;
  useWasmRepl?: boolean; // Toggles the local browser-ide environment [cite: 5]
}