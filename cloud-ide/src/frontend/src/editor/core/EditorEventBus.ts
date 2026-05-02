// frontend/src/editor/core/EditorEventBus.ts

export interface EditorEventPayloads {
    // --- UI & TAB MANAGEMENT ---
  'FILE_OPEN_REQUESTED': { path: string };
  'TAB_ACTIVATED': { path: string };
  'TAB_CLOSED': { path: string };

  // --- VFS & FILE DATA ---
  'FILE_LOADED': { path: string; content: string; language: string };
  // Fired by Monaco when text changes
  'CONTENT_CHANGED': { path: string; newContent: string; isDirty?: boolean };
  'SAVE_REQUESTED': { path: string };

  // --- EDITOR COMMANDS ---
  'COMMAND_FORMAT': { path: string };
  'COMMAND_PALETTE': {};

  // Command shortcuts caught by the InputManager
  'COMMAND_SAVE': { path: string };
  
  // Used by the Autocompletion system to request suggestions from the backend
  'COMPLETION_REQUESTED': { 
    path: string; 
    language: string;
    position: { lineNumber: number; column: number };
    word: string;
  };
}

export type EditorEventType = keyof EditorEventPayloads;

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