// terminal/core/TerminalEventBus.ts

import { TerminalEventType } from "../types/terminal";
import { TerminalEventPayloads } from "../types/terminal";

export interface ITerminalPlugin {
  /** A unique identifier for the plugin, highly recommended for debugging and logging. */
  name: string;

  /**
   * Called exactly once when the plugin is registered with the Event Bus.
   * This is where the plugin should set up its `bus.on(...)` event listeners.
   *
   * @param bus - The central TerminalEventBus instance to subscribe to.
   */

  install: (bus: TerminalEventBus) => void;
}

/**
 * The central Event Bus for the terminal application.
 * * This class implements a Pub/Sub (Observer) pattern, acting as the nervous system
 * that connects the core terminal mechanics (like command sniffing) to external 
 * plugins and side-effects. It ensures complete decoupling: plugins can react 
 * to terminal state without the terminal knowing the plugins exist.
 */
export class TerminalEventBus {
  /**
   * Internal registry of event listeners.
   * * Note: This uses a "loose" type (`Map<string, Set<Function>>`) internally to bypass 
   * TypeScript's strict generic assignment limitations when iterating over mapped types.
   * Type safety is strictly enforced at the boundaries via the public `on` and `emit` methods.
   * * @private
   */
  private listeners = new Map<string, Set<Function>>();

  /**
   * Subscribes a callback function to a specific terminal event.
   * * This method uses TypeScript generics to enforce a strict contract: the `callback` 
   * must accept the exact payload shape defined for the requested `event` in `TerminalEventPayloads`.
   *
   * @template K - The specific event type being listened to.
   * @param {K} event - The name of the event to listen for (e.g., 'COMMAND_START').
   * @param {(payload: TerminalEventPayloads[K]) => void} callback - The function to execute when the event fires.
   * @returns {() => void} A cleanup function that, when called, unsubscribes this specific listener.
   */
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

  /**
   * Broadcasts an event and its associated payload to all registered listeners.
   * * Execution of the callbacks is wrapped in a `setTimeout(..., 0)`. This ensures 
   * that heavy plugin computations (like building an AST or knowledge graph) are 
   * pushed to the end of the JS event loop, preventing them from blocking the 
   * main thread and causing input lag in the terminal UI.
   *
   * @template K - The specific event type being emitted.
   * @param {K} event - The name of the event to emit.
   * @param {TerminalEventPayloads[K]} payload - The strictly typed data payload required for this event.
   */
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

  /**
   * Registers and initializes a terminal plugin.
   * * This calls the plugin's `install` method, passing the current instance of the 
   * Event Bus so the plugin can set up its necessary event listeners.
   *
   * @param {ITerminalPlugin} plugin - The plugin instance to register.
   */
  public registerPlugin(plugin: ITerminalPlugin) {
    plugin.install(this);
  }
}