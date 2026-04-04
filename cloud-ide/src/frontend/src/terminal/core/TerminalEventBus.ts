// terminal/core/TerminalEventBus.ts

export interface TerminalEventPayloads {
  'COMMAND_START': { command: string };
  'COMMAND_OUTPUT': { output: string };
  'DIRECTORY_CHANGE': { path: string };
}

export type TerminalEventType = keyof TerminalEventPayloads;

export interface ITerminalPlugin {
  name: string;
  install: (bus: TerminalEventBus) => void;
}

export class TerminalEventBus {
  // 1. Loose internal state: Bypasses the TypeScript generic assignment limitation
  private listeners = new Map<string, Set<Function>>();

  // 2. Strict external signature: TypeScript enforces the correct K -> Payload mapping here
  public on<K extends TerminalEventType>(
    event: K,
    callback: (payload: TerminalEventPayloads[K]) => void
  ) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    // Safely add the callback to the map
    this.listeners.get(event)!.add(callback);

    // Return the unsubscribe function
    return () => this.listeners.get(event)!.delete(callback);
  }

  // 3. Strict external signature: Enforces correct payload when emitting
  public emit<K extends TerminalEventType>(
    event: K,
    payload: TerminalEventPayloads[K]
  ) {
    if (this.listeners.has(event)) {
      setTimeout(() => {
        // Execute all callbacks associated with this event
        this.listeners.get(event)!.forEach((cb) => cb(payload));
      }, 0);
    }
  }

  public registerPlugin(plugin: ITerminalPlugin) {
    plugin.install(this);
  }
}