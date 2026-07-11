import { describe, it, expect } from 'vitest';
import { createLanguageRegistry, LanguageRegistry } from './index';

describe('LanguageRegistry.detect', () => {
  const reg = createLanguageRegistry();

  it('maps extensions to language ids', () => {
    expect(reg.detect('/src/main.py')).toBe('python');
    expect(reg.detect('/a/b/App.tsx')).toBe('typescript');
    expect(reg.detect('/pkg/mod.go')).toBe('go');
  });

  it('matches exact filenames over extension fallback', () => {
    expect(reg.detect('/proj/Dockerfile')).toBe('dockerfile');
    expect(reg.detect('/proj/Makefile')).toBe('makefile');
  });

  it('is case-insensitive and unaffected by directories', () => {
    expect(reg.detect('/DIR/Notes.MD')).toBe('markdown');
  });

  it('falls back to plaintext for unknown or dotfiles', () => {
    expect(reg.detect('/x/data.unknownext')).toBe('plaintext');
    expect(reg.detect('/x/.gitignore')).toBe('plaintext'); // leading dot ≠ extension
    expect(reg.displayName('plaintext')).toBe('Plain Text');
  });

  it('lets a later registration override an id label and detection', () => {
    const r = new LanguageRegistry();
    r.register({ id: 'python', label: 'Py2', extensions: ['.py'] });
    r.register({ id: 'python', label: 'Python 3', extensions: ['.py'] });
    expect(r.detect('/x/a.py')).toBe('python');
    expect(r.displayName('python')).toBe('Python 3');
  });
});
