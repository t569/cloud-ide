// backend/src/services/lsp/LspSession.ts
//
// A JSON-RPC 2.0 conversation with ONE language server over ONE duplex stream.
// The stream is deliberately abstract (`Duplex`): a TCP socket today, an
// SSH-forwarded socket or a child process's stdio tomorrow — this class doesn't
// care. It owns the LSP handshake, id-correlated request/response, document
// sync, and fan-out of push diagnostics.

import { Duplex } from 'node:stream';
import { encodeMessage, MessageBuffer } from './framing';

interface Pending {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
}

/** A workspace file URI from an absolute host path (LSP speaks file:// URIs). */
export const pathToUri = (absPath: string): string =>
  'file://' + absPath.replace(/\\/g, '/').replace(/^\/?/, '/');

/** Inverse of pathToUri, for turning server diagnostics back into paths. */
export const uriToPath = (uri: string): string => uri.replace(/^file:\/\//, '');

export class LspSession {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnosticSubs = new Set<(path: string, diagnostics: any[]) => void>();
  private buffer = new MessageBuffer();
  private readonly initialized: Promise<void>;
  private disposed = false;

  constructor(private stream: Duplex, private rootUri = 'file:///workspace') {
    stream.on('data', (chunk: Buffer) => this.onData(chunk));
    stream.on('error', (err) => this.failAll(err));
    stream.on('close', () => this.failAll(new Error('LSP stream closed')));
    this.initialized = this.handshake();
  }

  /** Resolves once the server has completed the initialize handshake. */
  ready(): Promise<void> {
    return this.initialized;
  }

  // ---- wire ----------------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.buffer.append(chunk);
    for (const msg of this.buffer.drain()) this.dispatch(msg);
  }

  private dispatch(msg: any): void {
    // Response to one of our requests.
    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'LSP error'));
      else p.resolve(msg.result);
      return;
    }
    // Server-initiated request (e.g. workspace/configuration). We don't support
    // any, but must answer or the server can stall — reply with a null result.
    if (typeof msg.id === 'number' && msg.method) {
      this.send({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }
    // Notification. The only one we forward is diagnostics.
    if (msg.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = msg.params ?? {};
      this.diagnosticSubs.forEach((cb) => cb(uriToPath(uri ?? ''), diagnostics ?? []));
    }
  }

  private send(msg: unknown): void {
    if (!this.disposed) this.stream.write(encodeMessage(msg));
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  // ---- lifecycle -----------------------------------------------------------

  private async handshake(): Promise<void> {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      clientInfo: { name: 'cloud-ide' },
      capabilities: {
        textDocument: {
          synchronization: { didSave: false, dynamicRegistration: false },
          publishDiagnostics: {},
        },
      },
    });
    this.notify('initialized', {});
  }

  // uri -> last version we sent. The session is the version authority: the
  // frontend just says "the text changed", we assign the monotonic version LSP
  // requires. This is what lets the hybrid work — a lazy didOpen from disk, then
  // live didChange from the editor buffer, without the client tracking versions.
  private openVersions = new Map<string, number>();

  /**
   * Open a document exactly once. `loadText` is only called on the first open
   * (the hybrid's lazy read from the worktree), so repeat requests are cheap.
   */
  async ensureOpen(absPath: string, languageId: string, loadText: () => Promise<string> | string): Promise<void> {
    const uri = pathToUri(absPath);
    if (this.openVersions.has(uri)) return;
    const text = await loadText();
    this.openVersions.set(uri, 1);
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
  }

  /** Live full-text update from the editor buffer. No-op if the doc was never opened. */
  change(absPath: string, text: string): void {
    const uri = pathToUri(absPath);
    const prev = this.openVersions.get(uri);
    if (prev === undefined) return; // must ensureOpen first
    const version = prev + 1;
    this.openVersions.set(uri, version);
    this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  onDiagnostics(cb: (path: string, diagnostics: any[]) => void): () => void {
    this.diagnosticSubs.add(cb);
    return () => this.diagnosticSubs.delete(cb);
  }

  private failAll(err: Error): void {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new Error('LSP session disposed'));
    this.diagnosticSubs.clear();
    this.stream.destroy();
  }
}
