// Self-check for the atomic hot path: debounce-window coalescing.
import { coalesce, FsChange } from './FsEventHub';

const c = (kind: FsChange['kind'], path: string): FsChange => ({ kind, path });

describe('coalesce', () => {
  it('keeps one entry per path — last event wins', () => {
    // a file added then removed within the window nets to its final state (unlink)
    const out = coalesce([c('add', '/workspace/a.ts'), c('unlink', '/workspace/a.ts')]);
    expect(out).toEqual([c('unlink', '/workspace/a.ts')]);
  });

  it('preserves distinct paths and collapses duplicates', () => {
    const out = coalesce([
      c('add', '/workspace/a.ts'),
      c('addDir', '/workspace/src'),
      c('add', '/workspace/a.ts'), // duplicate churn on the same path
    ]);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(c('addDir', '/workspace/src'));
    expect(out).toContainEqual(c('add', '/workspace/a.ts'));
  });

  it('is empty for empty input', () => {
    expect(coalesce([])).toEqual([]);
  });
});
