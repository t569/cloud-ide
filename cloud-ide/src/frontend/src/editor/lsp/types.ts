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

/** go-to-definition uses the same shape as hover (a position in a document). */
export type DefinitionParams = HoverParams;

export interface Range {
  start: Position;
  end: Position;
}

/** A place in the workspace a symbol is defined. */
export interface Location {
  path: string;
  range: Range;
}

// --- Formatting ---
export interface TextEdit {
  range: Range;
  newText: string;
}

export interface FormattingParams {
  path: string;
  languageId: string;
  tabSize: number;
  insertSpaces: boolean;
}

// --- Signature help ---
export interface ParameterInfo {
  label: string;
  documentation?: string;
}

export interface SignatureInfo {
  label: string;
  documentation?: string;
  parameters: ParameterInfo[];
}

export interface SignatureHelp {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

/** signature help uses the same shape as hover (a position in a document). */
export type SignatureHelpParams = HoverParams;

// --- Rename ---
export interface RenameParams {
  path: string;
  languageId: string;
  position: Position;
  newName: string;
}

/** Edits grouped by file — a rename can touch many files at once. */
export interface WorkspaceEdit {
  changes: { path: string; edits: TextEdit[] }[];
}

export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  start: Position;
  end: Position;
}

/**
 * Connection state, surfaced in the status bar so the user knows whether they
 * have live language intelligence or are running on Monaco's built-in
 * highlighting alone. `offline` is not an error — it's the expected fallback
 * when the network or the backend language server is unreachable.
 */
export type LSPStatus = 'connecting' | 'connected' | 'offline';

/** One LSP content change: a ranged edit, or (no range) a full-document replacement. */
export interface ContentChange {
  range?: Range;
  text: string;
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
  provideDefinition?(params: DefinitionParams, signal: AbortSignal): Promise<Location[]>;
  provideFormatting?(params: FormattingParams, signal: AbortSignal): Promise<TextEdit[]>;
  provideSignatureHelp?(params: SignatureHelpParams, signal: AbortSignal): Promise<SignatureHelp | null>;
  provideRename?(params: RenameParams, signal: AbortSignal): Promise<WorkspaceEdit | null>;

  /** Push-based (server -> editor). Returns an unsubscribe fn. */
  onDiagnostics?(cb: (path: string, diagnostics: Diagnostic[]) => void): () => void;

  /** Current connection state, for the status bar. Omit if not applicable (e.g. the mock). */
  getStatus?(): LSPStatus;
  /** Subscribe to status changes. Returns an unsubscribe fn. */
  onStatusChange?(cb: (status: LSPStatus) => void): () => void;

  /**
   * Live document sync (editor -> server). Fire-and-forget: the server keeps up
   * with the unsaved buffer so completions/diagnostics reflect what's on screen.
   * `changes` are incremental deltas (tiny — the network win); `fullText` is the
   * whole buffer, sent only to (re)establish a baseline. The backend mirrors the
   * document, so callers never track versions.
   */
  notifyChange?(path: string, changes: ContentChange[], fullText: string): void;
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

/** monaco-shaped marker rectangle (1-based), minus the editor-specific severity enum. */
export interface MarkerData {
  message: string;
  severity: Diagnostic['severity'];
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Converts a transport `Diagnostic` (0-based) into a 1-based marker rectangle.
 * Pure/exported: the off-by-one boundary is the bug-prone part, so it is tested
 * here and the bridge only maps the severity string onto monaco's enum.
 */
export const diagnosticToMarker = (d: Diagnostic): MarkerData => ({
  message: d.message,
  severity: d.severity,
  startLineNumber: d.start.line + 1,
  startColumn: d.start.character + 1,
  endLineNumber: d.end.line + 1,
  endColumn: d.end.character + 1,
});

/** monaco-shaped rectangle (1-based), independent of the monaco Range class. */
export interface EditorRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Converts a transport `Range` (0-based) into a 1-based editor rectangle. */
export const toEditorRange = (r: Range): EditorRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});
