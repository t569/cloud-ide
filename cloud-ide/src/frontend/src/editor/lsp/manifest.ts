// frontend/src/editor/lsp/manifest.ts
//
// THE ONE PLACE YOU WIRE LANGUAGE BACKENDS.
// A factory (not a const array) so transports that need per-workspace config
// (sandboxId, socket URL) can be constructed fresh per editor instance. Swap a
// MockLSPTransport for a WebSocketLSPTransport here and nothing else changes.

import { ILanguageServerTransport } from './types';
import { MockLSPTransport } from './transports/MockLSPTransport';
// import { WebSocketLSPTransport } from './transports/WebSocketLSPTransport';
// import { WS_BASE_URL } from '../../config/env';

export function createLanguageTransports(/* sandboxId?: string */): ILanguageServerTransport[] {
  return [
    new MockLSPTransport('python'),
    // Go live by swapping the line above for:
    // new WebSocketLSPTransport('python', `${WS_BASE_URL}/lsp/python`),
  ];
}
