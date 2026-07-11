// frontend/src/editor/lsp/transports/HttpLSPTransport.ts
//
// Production transport that reaches a REMOTE ("online") language server without
// a WebSocket. The wire is split across two hops:
//
//   browser  ──debounced fetch (request/response) + SSE (diagnostics push)──▶  backend
//   backend  ──TCP socket, optionally through an SSH tunnel──▶  language server
//
// This file owns the FIRST hop only — the browser can't open TCP/SSH, so the
// backend proxy owns the tunnel (a later slice). The two design goals live here:
//   • low latency / low chatter — high-frequency requests (completion, hover,
//     signature help) are DEBOUNCED and cancelled via AbortSignal the instant
//     the user keeps typing, so only the last keystroke in a burst hits the wire.
//   • graceful offline — if the backend/LSP is unreachable, requests resolve to
//     empty instead of throwing, and status flips to `offline`. Monaco's built-in
//     syntax highlighting keeps working; the user just loses live intelligence.
//
// Backend HTTP contract:
//   POST {API}/lsp/:languageId/:method   body = params      -> JSON result
//   GET  {API}/lsp/:languageId/diagnostics                  -> SSE: {path,diagnostics}
//
// Swapping the mock/WebSocket transport for this in lsp/manifest.ts is the only
// change needed to go live — nothing else in the editor moves.

import {
  ILanguageServerTransport, LSPStatus,
  CompletionItem, CompletionParams, HoverParams, Hover,
  DefinitionParams, Location, FormattingParams, TextEdit,
  SignatureHelpParams, SignatureHelp, RenameParams, WorkspaceEdit, Diagnostic,
} from '../types';
import { apiClient, ApiError } from '../../../lib/apiClient';
import { API_BASE_URL } from '../../../config/env';

const DEFAULT_DEBOUNCE_MS = 150;

/** A cancellable delay: resolves after `ms`, or rejects with AbortError if the signal fires first. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export class HttpLSPTransport implements ILanguageServerTransport {
  private status: LSPStatus = 'connecting';
  private statusSubs = new Set<(s: LSPStatus) => void>();
  private diagnosticSource: EventSource | null = null;

  constructor(
    public readonly languageId: string,
    private debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  getStatus(): LSPStatus {
    return this.status;
  }

  onStatusChange(cb: (s: LSPStatus) => void): () => void {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  private setStatus(s: LSPStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.statusSubs.forEach((cb) => cb(s));
  }

  /**
   * One request to the backend proxy. `fallback` is returned (instead of
   * throwing) when the server is unreachable, so a dead LSP never breaks typing.
   * Cancellation (AbortSignal) is re-thrown so Monaco drops the stale result.
   */
  private async request<T>(
    method: string,
    params: unknown,
    signal: AbortSignal,
    fallback: T,
    debounce = false,
  ): Promise<T> {
    try {
      if (debounce && this.debounceMs > 0) await delay(this.debounceMs, signal);
      const result = await apiClient.post<T>(
        `/lsp/${encodeURIComponent(this.languageId)}/${method}`,
        params,
        { signal },
      );
      this.setStatus('connected');
      return result ?? fallback;
    } catch (err) {
      // A cancelled request (new keystroke) must look like a cancellation to
      // Monaco, not an error — and must not flip us offline.
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Unreachable backend (network) or no proxy route yet (404) => offline.
      // A real server-side error leaves status alone but still degrades quietly.
      if (err instanceof ApiError && (err.status === 0 || err.status === 404)) {
        this.setStatus('offline');
      }
      return fallback;
    }
  }

  provideCompletions(p: CompletionParams, s: AbortSignal): Promise<CompletionItem[]> {
    return this.request('completion', p, s, [], /* debounce */ true);
  }
  provideHover(p: HoverParams, s: AbortSignal): Promise<Hover | null> {
    return this.request('hover', p, s, null, true);
  }
  provideSignatureHelp(p: SignatureHelpParams, s: AbortSignal): Promise<SignatureHelp | null> {
    return this.request('signatureHelp', p, s, null, true);
  }
  // Explicit user actions (not per-keystroke) — no debounce, they should feel instant.
  provideDefinition(p: DefinitionParams, s: AbortSignal): Promise<Location[]> {
    return this.request('definition', p, s, []);
  }
  provideFormatting(p: FormattingParams, s: AbortSignal): Promise<TextEdit[]> {
    return this.request('formatting', p, s, []);
  }
  provideRename(p: RenameParams, s: AbortSignal): Promise<WorkspaceEdit | null> {
    return this.request('rename', p, s, null);
  }

  onDiagnostics(cb: (path: string, d: Diagnostic[]) => void): () => void {
    // The diagnostics stream doubles as our liveness signal: onopen => connected,
    // onerror => offline. Mirrors VFSController's fs-events EventSource.
    const url = `${API_BASE_URL}/lsp/${encodeURIComponent(this.languageId)}/diagnostics`;
    const src = new EventSource(url, { withCredentials: true });
    this.diagnosticSource = src;

    src.onopen = () => this.setStatus('connected');
    src.onerror = () => this.setStatus('offline');
    src.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; } // ignore heartbeats
      if (msg?.path && Array.isArray(msg.diagnostics)) cb(msg.path, msg.diagnostics);
    };

    return () => {
      src.close();
      if (this.diagnosticSource === src) this.diagnosticSource = null;
    };
  }

  dispose(): void {
    this.diagnosticSource?.close();
    this.diagnosticSource = null;
    this.statusSubs.clear();
  }
}
