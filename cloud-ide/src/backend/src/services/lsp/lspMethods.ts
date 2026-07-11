// backend/src/services/lsp/lspMethods.ts
//
// Translation between the editor's transport-agnostic method names (what the
// frontend HttpLSPTransport sends: 'completion', 'hover', ...) and the LSP wire
// protocol ('textDocument/completion', ...), plus result normalization back
// into the shapes the frontend's lsp/types.ts expects.
//
// PURE and unit-tested: this is where LSP's many result shapes (a Hover can be a
// string, a {language,value}, a MarkupContent, or an array of those; a
// definition can be one Location, many, or LocationLinks) get flattened into the
// editor's single shape. Keeping it pure means the proxy and routes stay thin.

import { uriToPath } from './LspSession';

/** Frontend port method -> LSP request method. Unknown methods are rejected by the router. */
export const PORT_TO_LSP: Record<string, string> = {
  completion: 'textDocument/completion',
  hover: 'textDocument/hover',
  definition: 'textDocument/definition',
  formatting: 'textDocument/formatting',
  signatureHelp: 'textDocument/signatureHelp',
  rename: 'textDocument/rename',
};

// LSP CompletionItemKind (numeric) -> our CompletionKind string. Kinds we don't
// model collapse to the nearest we do; anything unknown falls back to 'text'.
const COMPLETION_KIND: Record<number, string> = {
  1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field',
  6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property',
  12: 'value', 13: 'value', 14: 'keyword', 15: 'snippet', 21: 'value',
};

interface LspRequestParams {
  uri: string; // the file:// URI as the LANGUAGE SERVER sees it (host path), resolved by the proxy
  position?: { line: number; character: number };
  newName?: string;
  tabSize?: number;
  insertSpaces?: boolean;
}

/** Build LSP request params. 0-based positions map 1:1; the uri is pre-resolved by the caller. */
export function toLspParams(method: string, p: LspRequestParams): unknown {
  const textDocument = { uri: p.uri };
  switch (method) {
    case 'formatting':
      return { textDocument, options: { tabSize: p.tabSize ?? 2, insertSpaces: p.insertSpaces ?? true } };
    case 'rename':
      return { textDocument, position: p.position, newName: p.newName };
    default: // completion, hover, definition, signatureHelp
      return { textDocument, position: p.position };
  }
}

// ---- result normalization --------------------------------------------------

function normalizeHoverContents(contents: any): string[] {
  if (contents == null) return [];
  const one = (c: any): string =>
    typeof c === 'string' ? c : c?.value ?? '';
  return (Array.isArray(contents) ? contents.map(one) : [one(contents)]).filter(Boolean);
}

/**
 * Convert an LSP result into the port shape for `method`. `toWorkspacePath` maps
 * a server file URI back to the path the frontend uses (host path -> /workspace/…);
 * defaults to a bare uri->path strip for callers that don't remap (e.g. tests).
 */
export function fromLspResult(
  method: string,
  result: any,
  toWorkspacePath: (uri: string) => string = uriToPath,
): unknown {
  switch (method) {
    case 'completion': {
      const items = Array.isArray(result) ? result : result?.items ?? [];
      return items.map((it: any) => ({
        label: typeof it.label === 'string' ? it.label : it.label?.label ?? '',
        kind: COMPLETION_KIND[it.kind] ?? 'text',
        insertText: it.insertText ?? it.textEdit?.newText ?? (typeof it.label === 'string' ? it.label : ''),
        detail: it.detail,
        documentation: typeof it.documentation === 'string' ? it.documentation : it.documentation?.value,
      }));
    }
    case 'hover':
      return result ? { contents: normalizeHoverContents(result.contents) } : null;
    case 'definition': {
      if (!result) return [];
      const locs = Array.isArray(result) ? result : [result];
      // LocationLink uses targetUri/targetRange; Location uses uri/range.
      return locs.map((l: any) => ({
        path: toWorkspacePath(l.uri ?? l.targetUri ?? ''),
        range: l.range ?? l.targetSelectionRange ?? l.targetRange,
      }));
    }
    case 'formatting':
      return Array.isArray(result) ? result : []; // TextEdit[] already matches the port shape
    case 'signatureHelp':
      return result ?? null;
    case 'rename': {
      // WorkspaceEdit.changes is { [uri]: TextEdit[] }; the port wants [{path,edits}].
      const changes = result?.changes ?? {};
      return { changes: Object.entries(changes).map(([uri, edits]) => ({ path: toWorkspacePath(uri), edits })) };
    }
    default:
      return result ?? null;
  }
}
