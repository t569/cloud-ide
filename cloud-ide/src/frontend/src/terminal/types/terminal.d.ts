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

  /**
   * A standardized event emitted by plugins to request dynamic React UI renders.
   * * This acts as the bridge between the raw terminal text stream (the canvas) 
   * and the interactive IDE workspace (React). When a plugin detects actionable 
   * context (like a recognized file name, a clickable link, or a suggested git command), 
   * it broadcasts this payload so that listening React components (like the Context Widget) 
   * can render the appropriate UI elements on top of or adjacent to the terminal.
   */
  'UI_CONTEXT_SUGGESTED': { 
    /** * The unique identifier of the plugin that emitted this suggestion 
     * (e.g., 'FileIconPlugin' or 'GitConflictPlugin'). 
     * Useful for debugging, analytics, or allowing the UI to filter out specific plugins.
     */
    sourcePlugin: string; 

    /** * The category of the suggested context, which dictates how the listening 
     * React UI should render the elements.
     * - `files`: Instructs the UI to render clickable file icons (to open in the editor).
     * - `actions`: Instructs the UI to render executable command buttons (e.g., 'Resolve Conflict').
     * - `links`: Instructs the UI to render clickable URL anchor tags.
     */
    type: 'files' | 'actions' | 'links'; 

    /** * The array of actionable string items detected by the plugin.
     * * **Architectural Note:** Passing an empty array (`[]`) is the strict standard 
     * signal to instruct the React UI to clear its state and unmount the widget.
     */
    items: string[]; 
  };

  /**
   * A signal to the React Ui to mount/unmount the search widget
   */
  'UI_TOGGLE_SEARCH': { isVisible?: boolean };
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


