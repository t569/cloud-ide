// backend/src/services/lsp/textEdit.ts
//
// Applies LSP incremental content changes to a text buffer. This is what lets
// the browser send tiny deltas over the network while the backend keeps a full
// mirror of each open document — so it can hand ANY language server a complete,
// correct buffer regardless of that server's sync capability. Pure + tested: the
// offset arithmetic (0-based line/character -> string index) is the fiddly part.

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
/** One change: a ranged edit, or (no range) a full-document replacement. */
export interface ContentChange {
  range?: Range;
  text: string;
}

/** String index of a 0-based {line, character}, clamped to the line and buffer. */
function offsetAt(text: string, pos: Position): number {
  let i = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) return text.length; // position past EOF -> clamp to end
    i = nl + 1;
  }
  const lineEnd = text.indexOf('\n', i);
  const max = lineEnd === -1 ? text.length : lineEnd;
  return Math.min(i + pos.character, max);
}

export function applyContentChange(text: string, change: ContentChange): string {
  if (!change.range) return change.text; // full replacement
  const start = offsetAt(text, change.range.start);
  const end = offsetAt(text, change.range.end);
  return text.slice(0, start) + change.text + text.slice(end);
}

/** Fold a batch of changes left-to-right (LSP applies them in order). */
export function applyContentChanges(text: string, changes: ContentChange[]): string {
  return changes.reduce(applyContentChange, text);
}
