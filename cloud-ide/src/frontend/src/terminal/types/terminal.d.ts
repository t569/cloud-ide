// terminal/types/terminal.d.ts

/**
 * Handles communication to and from an execution environment 
 * (either Docker backend or local WASM REPL or local sandbox whatever you want pookie).
 */

export interface ITransportStream {
  connect(): Promise<void>;
  disconnect(): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;   // this is connected to our middleware
  onError(callback: (error: Error) => void): void;  // this is connected to our middleware
  resize?(cols: number, rows: number): void;
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

/**
 * Defines the strict mapping between Terminal events and their expected payloads.
 * This acts as the central registry for the Event Bus, ensuring 100% type safety
 * when emitting or listening to events across the application.
 */

export interface TerminalEventPayloads {
  /** * Fired immediately when a user submits a command (e.g., hitting Enter), 
   * before backend execution begins. 
   */
  'COMMAND_START': { command: string };


  /** * Fired whenever the terminal backend pushes standard output or error logs 
   * to the screen. Useful for parsing output streams for specific patterns.
   */
  'COMMAND_OUTPUT': { output: string };


  /** * Fired when the active working directory of the terminal changes. 
   */
  'DIRECTORY_CHANGE': { path: string };
}

/**
 * A union type of all valid event names, automatically derived from the keys of 
 * TerminalEventPayloads. (e.g., 'COMMAND_START' | 'COMMAND_OUTPUT' | 'DIRECTORY_CHANGE')
 */
export type TerminalEventType = keyof TerminalEventPayloads;

/**
 * The core contract for extending the Terminal's functionality.
 * Plugins encapsulate automated behaviors or UI side-effects (like knowledge graph 
 * building or file icon rendering) without modifying the core terminal component.
 */


