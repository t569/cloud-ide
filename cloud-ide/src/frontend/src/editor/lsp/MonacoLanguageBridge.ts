// frontend/src/editor/lsp/MonacoLanguageBridge.ts
//
// THE ONLY MONACO-AWARE PIECE OF THE LANGUAGE-SERVICE STACK.
// It adapts an `ILanguageServerTransport` (transport-agnostic) onto monaco's
// provider APIs. Written once, reused by every language — no per-language
// provider wiring. If you ever replace monaco with another editor, this is the
// single file you rewrite; the transports and registry are untouched.

import * as monaco from 'monaco-editor';
import { ILanguageServerTransport, CompletionKind } from './types';
import { toPortPosition } from './types';

const KIND_MAP: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  text: monaco.languages.CompletionItemKind.Text,
  method: monaco.languages.CompletionItemKind.Method,
  function: monaco.languages.CompletionItemKind.Function,
  constructor: monaco.languages.CompletionItemKind.Constructor,
  field: monaco.languages.CompletionItemKind.Field,
  variable: monaco.languages.CompletionItemKind.Variable,
  class: monaco.languages.CompletionItemKind.Class,
  interface: monaco.languages.CompletionItemKind.Interface,
  module: monaco.languages.CompletionItemKind.Module,
  property: monaco.languages.CompletionItemKind.Property,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  snippet: monaco.languages.CompletionItemKind.Snippet,
  value: monaco.languages.CompletionItemKind.Value,
};

/** Bridge monaco's CancellationToken onto a standard AbortSignal. */
function signalFromToken(token: monaco.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

export class MonacoLanguageBridge {
  constructor(private transport: ILanguageServerTransport) {}

  /**
   * Registers monaco providers for whichever capabilities the transport
   * advertises. Returns disposables the caller must dispose on unmount.
   */
  install(m: typeof monaco): monaco.IDisposable[] {
    const lang = this.transport.languageId;
    const disposables: monaco.IDisposable[] = [];

    if (this.transport.provideCompletions) {
      disposables.push(m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.'],
        provideCompletionItems: async (model, position, _ctx, token) => {
          const word = model.getWordUntilPosition(position);
          const items = await this.transport.provideCompletions!(
            {
              path: model.uri.path,
              languageId: lang,
              position: toPortPosition(position.lineNumber, position.column),
              prefix: word.word,
            },
            signalFromToken(token),
          );

          // Replace exactly the word under the cursor.
          const range = new m.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          );

          return {
            suggestions: items.map(item => ({
              label: item.label,
              kind: KIND_MAP[item.kind] ?? m.languages.CompletionItemKind.Text,
              insertText: item.insertText,
              detail: item.detail,
              documentation: item.documentation,
              range,
            })),
          };
        },
      }));
    }

    if (this.transport.provideHover) {
      disposables.push(m.languages.registerHoverProvider(lang, {
        provideHover: async (model, position, token) => {
          const hover = await this.transport.provideHover!(
            {
              path: model.uri.path,
              languageId: lang,
              position: toPortPosition(position.lineNumber, position.column),
            },
            signalFromToken(token),
          );
          if (!hover) return null;
          return { contents: hover.contents.map(value => ({ value })) };
        },
      }));
    }

    return disposables;
  }
}
