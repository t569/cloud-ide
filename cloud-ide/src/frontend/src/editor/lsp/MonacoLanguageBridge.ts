// frontend/src/editor/lsp/MonacoLanguageBridge.ts
//
// THE ONLY MONACO-AWARE PIECE OF THE LANGUAGE-SERVICE STACK.
// It adapts an `ILanguageServerTransport` (transport-agnostic) onto monaco's
// provider APIs. Written once, reused by every language — no per-language
// provider wiring. If you ever replace monaco with another editor, this is the
// single file you rewrite; the transports and registry are untouched.

import * as monaco from 'monaco-editor';
import { ILanguageServerTransport, CompletionKind, Diagnostic } from './types';
import { toPortPosition, diagnosticToMarker, toEditorRange } from './types';

const SEVERITY_MAP: Record<Diagnostic['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
};

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

    if (this.transport.provideDefinition) {
      disposables.push(m.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position, token) => {
          const locations = await this.transport.provideDefinition!(
            {
              path: model.uri.path,
              languageId: lang,
              position: toPortPosition(position.lineNumber, position.column),
            },
            signalFromToken(token),
          );
          return locations.map(loc => {
            const r = toEditorRange(loc.range);
            return {
              uri: m.Uri.parse(loc.path),
              range: new m.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn),
            };
          });
        },
      }));
    }

    if (this.transport.provideFormatting) {
      disposables.push(m.languages.registerDocumentFormattingEditProvider(lang, {
        provideDocumentFormattingEdits: async (model, options, token) => {
          const edits = await this.transport.provideFormatting!(
            {
              path: model.uri.path,
              languageId: lang,
              tabSize: options.tabSize,
              insertSpaces: options.insertSpaces,
            },
            signalFromToken(token),
          );
          return edits.map(edit => {
            const r = toEditorRange(edit.range);
            return {
              range: new m.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn),
              text: edit.newText,
            };
          });
        },
      }));
    }

    if (this.transport.provideSignatureHelp) {
      disposables.push(m.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: async (model, position, token, _context) => {
          const help = await this.transport.provideSignatureHelp!(
            {
              path: model.uri.path,
              languageId: lang,
              position: toPortPosition(position.lineNumber, position.column),
            },
            signalFromToken(token),
          );
          if (!help) return null;
          return {
            value: {
              signatures: help.signatures.map(sig => ({
                label: sig.label,
                documentation: sig.documentation,
                parameters: sig.parameters.map(p => ({ label: p.label, documentation: p.documentation })),
              })),
              activeSignature: help.activeSignature,
              activeParameter: help.activeParameter,
            },
            dispose: () => {},
          };
        },
      }));
    }

    // Diagnostics are push-based (server -> editor). Translate each batch into
    // monaco markers (the squiggly underlines) on the matching model. Owner is
    // the languageId so languages never clobber each other's markers.
    if (this.transport.onDiagnostics) {
      const unsubscribe = this.transport.onDiagnostics((path, diagnostics) => {
        const model = m.editor.getModel(m.Uri.parse(path));
        if (!model) return;
        m.editor.setModelMarkers(model, lang, diagnostics.map(d => {
          const marker = diagnosticToMarker(d);
          return { ...marker, severity: SEVERITY_MAP[marker.severity] };
        }));
      });
      disposables.push({ dispose: unsubscribe });
    }

    return disposables;
  }
}
