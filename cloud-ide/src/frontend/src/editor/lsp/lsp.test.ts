import { describe, it, expect } from 'vitest';
import { toPortPosition, diagnosticToMarker, toEditorRange } from './types';
import { MockLSPTransport } from './transports/MockLSPTransport';

describe('toPortPosition', () => {
  it('converts monaco 1-based to LSP 0-based', () => {
    expect(toPortPosition(1, 1)).toEqual({ line: 0, character: 0 });
    expect(toPortPosition(10, 5)).toEqual({ line: 9, character: 4 });
  });
});

describe('toEditorRange', () => {
  it('converts a 0-based range to a 1-based editor rectangle', () => {
    expect(toEditorRange({ start: { line: 0, character: 0 }, end: { line: 4, character: 7 } }))
      .toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 5, endColumn: 8 });
  });
});

describe('diagnosticToMarker', () => {
  it('converts 0-based diagnostic to a 1-based marker rectangle', () => {
    const marker = diagnosticToMarker({
      message: 'undefined name',
      severity: 'error',
      start: { line: 2, character: 4 },
      end: { line: 2, character: 9 },
    });
    expect(marker).toEqual({
      message: 'undefined name',
      severity: 'error',
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 10,
    });
  });
});

describe('MockLSPTransport', () => {
  const t = new MockLSPTransport('python');
  const params = (prefix: string) => ({ path: '/x.py', languageId: 'python', position: { line: 0, character: 0 }, prefix });

  it('filters the vocabulary by prefix (case-insensitive)', async () => {
    const items = await t.provideCompletions(params('pr'));
    expect(items.map(i => i.label)).toEqual(['print']);
  });

  it('returns everything when prefix is empty', async () => {
    const items = await t.provideCompletions(params(''));
    expect(items.length).toBeGreaterThan(1);
  });

  it('returns nothing for a non-matching prefix', async () => {
    expect(await t.provideCompletions(params('zzz'))).toEqual([]);
  });

  it('advertises hover', async () => {
    const hover = await t.provideHover({ path: '/x.py', languageId: 'python', position: { line: 0, character: 0 } });
    expect(hover?.contents[0]).toContain('python');
  });
});
