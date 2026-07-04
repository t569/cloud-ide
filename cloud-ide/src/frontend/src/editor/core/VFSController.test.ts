import { describe, it, expect } from 'vitest';
import { safePath } from './VFSController';

describe('safePath', () => {
  it('accepts and normalizes clean paths', () => {
    expect(safePath('/src/main.py')).toBe('/src/main.py');
    expect(safePath('src/main.py')).toBe('/src/main.py');   // forces rooting
    expect(safePath('/src//./main.py')).toBe('/src/main.py'); // collapses // and .
  });

  it('rejects traversal', () => {
    expect(safePath('../../etc/passwd')).toBeNull();
    expect(safePath('/src/../../../etc/passwd')).toBeNull();
    expect(safePath('/a/b/../c')).toBeNull(); // any `..` segment is refused
  });

  it('rejects null bytes and empty paths', () => {
    expect(safePath('/src/x\0.py')).toBeNull();
    expect(safePath('')).toBeNull();
    expect(safePath('/')).toBeNull();
    expect(safePath('///')).toBeNull();
  });
});
