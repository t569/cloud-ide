import { PORT_TO_LSP, toLspParams, fromLspResult } from './lspMethods';

describe('lspMethods.toLspParams', () => {
  it('passes through the pre-resolved uri and 0-based position', () => {
    expect(toLspParams('completion', { uri: 'file:///wt/a.py', position: { line: 2, character: 5 } }))
      .toEqual({ textDocument: { uri: 'file:///wt/a.py' }, position: { line: 2, character: 5 } });
  });

  it('carries formatting options and the rename target', () => {
    expect(toLspParams('formatting', { uri: 'file:///x', tabSize: 4, insertSpaces: false }))
      .toEqual({ textDocument: { uri: 'file:///x' }, options: { tabSize: 4, insertSpaces: false } });
    expect(toLspParams('rename', { uri: 'file:///x', position: { line: 0, character: 0 }, newName: 'y' }))
      .toMatchObject({ newName: 'y' });
  });
});

describe('lspMethods.fromLspResult', () => {
  it('maps completion kinds and a CompletionList wrapper', () => {
    const out: any = fromLspResult('completion', {
      isIncomplete: false,
      items: [{ label: 'print', kind: 3, insertText: 'print' }], // 3 = Function
    });
    expect(out).toEqual([{ label: 'print', kind: 'function', insertText: 'print', detail: undefined, documentation: undefined }]);
  });

  it('normalizes the many hover content shapes into string[]', () => {
    expect(fromLspResult('hover', { contents: 'plain' })).toEqual({ contents: ['plain'] });
    expect(fromLspResult('hover', { contents: { kind: 'markdown', value: '# md' } })).toEqual({ contents: ['# md'] });
    expect(fromLspResult('hover', { contents: [{ value: 'a' }, 'b'] })).toEqual({ contents: ['a', 'b'] });
    expect(fromLspResult('hover', null)).toBeNull();
  });

  it('maps definitions (Location and LocationLink) through the reverse path mapper', () => {
    const rev = (uri: string) => uri.replace('file:///wt', '/workspace');
    expect(fromLspResult('definition', { uri: 'file:///wt/a.py', range: { start: {}, end: {} } }, rev))
      .toEqual([{ path: '/workspace/a.py', range: { start: {}, end: {} } }]);
    expect(fromLspResult('definition', [{ targetUri: 'file:///wt/b.py', targetRange: { start: {}, end: {} } }], rev))
      .toEqual([{ path: '/workspace/b.py', range: { start: {}, end: {} } }]);
  });

  it('has an LSP method for every supported port method', () => {
    expect(Object.keys(PORT_TO_LSP).sort()).toEqual(
      ['completion', 'definition', 'formatting', 'hover', 'rename', 'signatureHelp'].sort(),
    );
  });
});
