// frontend/src/editor/lsp/manifest.ts
//
// THE ONE PLACE YOU WIRE LANGUAGE BACKENDS.
// A factory (not a const array) so transports that need per-workspace config
// (sandboxId, socket URL) can be constructed fresh per editor instance. Swap a
// MockLSPTransport for a WebSocketLSPTransport here and nothing else changes.

import { ILanguageServerTransport } from './types';
import { HttpLSPTransport } from './transports/HttpLSPTransport';
// import { MockLSPTransport } from './transports/MockLSPTransport';

export function createLanguageTransports(/* sandboxId?: string */): ILanguageServerTransport[] {
  return [
    // Online LSP over debounced HTTP + SSE (the backend proxy owns the TCP/SSH
    // tunnel). Degrades to `offline` and Monaco highlighting when unreachable.
    // One line per language; the backend proxy routes by :languageId.
    new HttpLSPTransport('python'),
    // For backend-less local dev with fake intelligence, swap for:
    // new MockLSPTransport('python'),
  ];
}
