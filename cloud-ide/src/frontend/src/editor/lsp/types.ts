// frontend/src/editor/lsp/types.ts
//
// ============================================================================
// LANGUAGE SERVICE — TRANSPORT-AGNOSTIC CONTRACTS (THE PORT)
// ============================================================================
// NOTHING in this file may import monaco. A transport author (WebSocket, WASM,
// HTTP, mock, or your own) implements `ILanguageServerTransport` without ever
// touching the editor UI. The MonacoLanguageBridge is the ONLY monaco-aware
// piece — it adapts this port onto the concrete editor. Swap the editor, keep
// the transports; swap the transport, keep the editor.

/** 0-based, LSP-style cursor position. */
export interface Position {
  line: number;
  character: number;
}

export type CompletionKind =
  | 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable'
  | 'class' | 'interface' | 'module' | 'property' | 'keyword' | 'snippet' | 'value';

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  insertText: string;
  detail?: string;
  documentation?: string;
}

export interface CompletionParams {
  path: string;         // e.g. '/src/main.py'
  languageId: string;
  position: Position;
  prefix: string;       // the partial word under the cursor
}

export interface HoverParams {
  path: string;
  languageId: string;
  position: Position;
}

export interface Hover {
  /** Markdown strings, rendered top-to-bottom. */
  contents: string[];
}

export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  start: Position;
  end: Position;
}

/**
 * THE PORT. Any language backend implements this.
 *
 * It is request/response (promises) because that is what LSP features
 * fundamentally are — a fire-and-forget event bus cannot return a completion
 * list. Every capability is OPTIONAL: a transport advertises only what it
 * supports and the bridge wires up exactly those. Cancellation is a standard
 * `AbortSignal`, so a slow request is abandoned the instant the user keeps
 * typing — that is what keeps the editor fast under a remote language server.
 */
export interface ILanguageServerTransport {
  readonly languageId: string;

  /** Optional lifecycle — e.g. open a WebSocket. Safe to call repeatedly. */
  connect?(): Promise<void>;
  dispose?(): void;

  provideCompletions?(params: CompletionParams, signal: AbortSignal): Promise<CompletionItem[]>;
  provideHover?(params: HoverParams, signal: AbortSignal): Promise<Hover | null>;

  /** Push-based (server -> editor). Returns an unsubscribe fn. */
  onDiagnostics?(cb: (path: string, diagnostics: Diagnostic[]) => void): () => void;
}

/**
 * monaco positions are 1-based (lineNumber/column); this port is 0-based
 * (LSP convention). Pure + exported so the conversion is unit-testable and the
 * bridge stays a thin adapter.
 */
export const toPortPosition = (lineNumber: number, column: number): Position => ({
  line: lineNumber - 1,
  character: column - 1,
});
