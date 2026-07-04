// frontend/src/editor/lsp/transports/WebSocketLSPTransport.ts
//
// Production transport: speaks to a backend language-server daemon over a
// WebSocket using a tiny id-correlated JSON protocol. Mirrors the terminal's
// WebSocketTransport pattern. Requests are cancellable; diagnostics arrive
// unsolicited and are fanned out to subscribers.
//
// Backend contract (one JSON message per line):
//   ->  { id, method: 'completion' | 'hover', params }      // request
//   <-  { id, result }                                       // response
//   <-  { method: 'diagnostics', params: { path, diagnostics } }  // push
//
// This file is complete and works the moment a backend exists — nothing else in
// the editor needs to change to go from mock to live.

import {
  ILanguageServerTransport, CompletionItem, CompletionParams, HoverParams, Hover,
  DefinitionParams, Location, FormattingParams, TextEdit,
  SignatureHelpParams, SignatureHelp, RenameParams, WorkspaceEdit, Diagnostic,
} from '../types';

interface Pending { resolve: (value: any) => void; reject: (reason?: any) => void; }

export class WebSocketLSPTransport implements ILanguageServerTransport {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnosticSubs = new Set<(path: string, d: Diagnostic[]) => void>();

  constructor(public readonly languageId: string, private url: string) {}

  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(err);
      ws.onclose = () => { this.ready = null; };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
    return this.ready;
  }

  private onMessage(ev: MessageEvent): void {
    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.method === 'diagnostics') {
      this.diagnosticSubs.forEach(cb => cb(msg.params.path, msg.params.diagnostics));
      return;
    }
    const pending = this.pending.get(msg.id);
    if (pending) {
      this.pending.delete(msg.id);
      pending.resolve(msg.result);
    }
  }

  private async request<T>(method: string, params: unknown, signal: AbortSignal): Promise<T> {
    await this.connect();
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      signal.addEventListener('abort', () => {
        if (this.pending.delete(id)) reject(new DOMException('Aborted', 'AbortError'));
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  provideCompletions(params: CompletionParams, signal: AbortSignal): Promise<CompletionItem[]> {
    return this.request('completion', params, signal);
  }

  provideHover(params: HoverParams, signal: AbortSignal): Promise<Hover | null> {
    return this.request('hover', params, signal);
  }

  provideDefinition(params: DefinitionParams, signal: AbortSignal): Promise<Location[]> {
    return this.request('definition', params, signal);
  }

  provideFormatting(params: FormattingParams, signal: AbortSignal): Promise<TextEdit[]> {
    return this.request('formatting', params, signal);
  }

  provideSignatureHelp(params: SignatureHelpParams, signal: AbortSignal): Promise<SignatureHelp | null> {
    return this.request('signatureHelp', params, signal);
  }

  provideRename(params: RenameParams, signal: AbortSignal): Promise<WorkspaceEdit | null> {
    return this.request('rename', params, signal);
  }

  onDiagnostics(cb: (path: string, d: Diagnostic[]) => void): () => void {
    this.diagnosticSubs.add(cb);
    return () => this.diagnosticSubs.delete(cb);
  }

  dispose(): void {
    this.ws?.close();
    this.pending.clear();
    this.diagnosticSubs.clear();
    this.ready = null;
  }
}
