// frontend/src/terminal/transport/createTerminalTransport.ts
//
// The single place that decides which transport backs a terminal, by driver
// capability (TERMINAL_BACKEND.md step 4):
//   • pty  → interactive WebSocket PTY (WebSocketTransport ↔ gateway /pty bridge)
//   • else → line-mode command streaming (SseExecTransport)
// Keeps IDETerminal free of that choice. Today no driver advertises pty, so
// callers omit it and get SSE — no behavior change until a PTY driver lands.
import { API_BASE_URL } from '../../config/env';
import { ITransportStream } from '../types/terminal';
import { SseExecTransport } from './SseExecTransport';
import { WebSocketTransport } from './WebSocketTransport';

/** Derive the ws(s):// PTY URL from the http(s) API base (same host/port/origin).
 *  `termId` is the stable per-tab id the backend keys reattach on, so a reconnect
 *  re-binds to the same server-side shell rather than spawning a fresh one. */
function ptyUrl(sandboxId: string, terminalId?: string): string {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  const q = terminalId ? `?termId=${encodeURIComponent(terminalId)}` : '';
  return `${wsBase}/v1/sandboxes/${encodeURIComponent(sandboxId)}/pty${q}`;
}

export interface TransportOptions {
  /** True when the active sandbox driver supports an interactive PTY. */
  pty?: boolean;
  /** Initial terminal size, forwarded to the PTY on connect. */
  initialSize?: { cols: number; rows: number };
  /** Stable per-tab id → the backend reattaches to the same shell on reconnect. */
  terminalId?: string;
}

export function createTerminalTransport(sandboxId: string, opts: TransportOptions = {}): ITransportStream {
  if (opts.pty) return new WebSocketTransport(ptyUrl(sandboxId, opts.terminalId), opts.initialSize);
  return new SseExecTransport(sandboxId);
}
