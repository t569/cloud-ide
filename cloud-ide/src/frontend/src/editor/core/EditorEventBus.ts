// frontend/src/editor/core/EditorEventBus.ts
import { EditorEventPayloads, EditorEventType } from "../types/editor";

// We use the exact same Pub/Sub observer pattern from TerminalEventBus[cite: 8]
export class EditorEventBus {
  private listeners = new Map<string, Set<Function>>();

  public on<K extends EditorEventType>(
    event: K,
    callback: (payload: EditorEventPayloads[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)!.delete(callback);
  }

  public emit<K extends EditorEventType>(event: K, payload: EditorEventPayloads[K]) {
    if (this.listeners.has(event)) {
      setTimeout(() => {
        this.listeners.get(event)!.forEach((cb) => cb(payload));
      }, 0);
    }
  }
}