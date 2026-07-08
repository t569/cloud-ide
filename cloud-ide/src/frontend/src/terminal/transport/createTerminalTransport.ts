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

/** Derive the ws(s):// PTY URL from the http(s) API base (same host/port/origin). */
function ptyUrl(sandboxId: string): string {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/v1/sandboxes/${encodeURIComponent(sandboxId)}/pty`;
}

export interface TransportOptions {
  /** True when the active sandbox driver supports an interactive PTY. */
  pty?: boolean;
  /** Initial terminal size, forwarded to the PTY on connect. */
  initialSize?: { cols: number; rows: number };
}

export function createTerminalTransport(sandboxId: string, opts: TransportOptions = {}): ITransportStream {
  if (opts.pty) return new WebSocketTransport(ptyUrl(sandboxId), opts.initialSize);
  return new SseExecTransport(sandboxId);
}
