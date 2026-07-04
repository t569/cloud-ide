// frontend/src/editor/lsp/transports/MockLSPTransport.ts
//
// Zero-backend transport for local dev and tests. Returns a canned vocabulary
// filtered by the current prefix. Swap it for WebSocketLSPTransport (or your
// own) in the manifest — no editor code changes.

import {
  ILanguageServerTransport, CompletionItem, CompletionParams, HoverParams, Hover,
} from '../types';

const DEFAULT_VOCAB: CompletionItem[] = [
  { label: 'print', kind: 'function', insertText: 'print', detail: 'builtin' },
  { label: 'range', kind: 'function', insertText: 'range', detail: 'builtin' },
  { label: 'len', kind: 'function', insertText: 'len', detail: 'builtin' },
  { label: 'return', kind: 'keyword', insertText: 'return' },
  { label: 'import', kind: 'keyword', insertText: 'import' },
  { label: 'class', kind: 'keyword', insertText: 'class' },
];

export class MockLSPTransport implements ILanguageServerTransport {
  constructor(
    public readonly languageId: string,
    private vocabulary: CompletionItem[] = DEFAULT_VOCAB,
  ) {}

  async provideCompletions(params: CompletionParams): Promise<CompletionItem[]> {
    const prefix = params.prefix.toLowerCase();
    if (!prefix) return this.vocabulary;
    return this.vocabulary.filter(item => item.label.toLowerCase().startsWith(prefix));
  }

  async provideHover(_params: HoverParams): Promise<Hover | null> {
    return {
      contents: [
        `**${this.languageId}** language service (mock)`,
        'Wire a real transport in `lsp/manifest.ts` for live docs.',
      ],
    };
  }
}
