import { applyContentChange, applyContentChanges } from './textEdit';

const at = (line: number, character: number) => ({ line, character });

describe('applyContentChange', () => {
  it('replaces a full document when there is no range', () => {
    expect(applyContentChange('old', { text: 'new' })).toBe('new');
  });

  it('inserts at a position (empty range)', () => {
    // "ab\ncd" -> insert 'X' at line 1, col 1  => "ab\ncXd"
    expect(applyContentChange('ab\ncd', { range: { start: at(1, 1), end: at(1, 1) }, text: 'X' })).toBe('ab\ncXd');
  });

  it('replaces a ranged selection, including across lines', () => {
    // remove from (0,1) to (1,1): "abc\ndef" -> "a" + "ef" = "aef"
    expect(applyContentChange('abc\ndef', { range: { start: at(0, 1), end: at(1, 1) }, text: '' })).toBe('aef');
  });

  it('clamps a character past the end of its line', () => {
    // col 99 on line 0 ("ab") clamps to end-of-line (offset 2), so 'X' lands before the newline
    expect(applyContentChange('ab\ncd', { range: { start: at(0, 99), end: at(0, 99) }, text: 'X' })).toBe('abX\ncd');
  });

  it('applies a batch in order (typing "hi")', () => {
    let t = '';
    t = applyContentChanges(t, [{ range: { start: at(0, 0), end: at(0, 0) }, text: 'h' }]);
    t = applyContentChanges(t, [{ range: { start: at(0, 1), end: at(0, 1) }, text: 'i' }]);
    expect(t).toBe('hi');
  });
});
