// The v3 catalog mapping is defensive across Hub revisions; pin the field reads so a
// wrong assumption fails here instead of shipping blank/misflagged search results.
import { toResult } from './images.routes';

describe('toResult (Docker Hub v3 catalog -> ImageResult)', () => {
  it('maps an official image and marks it official via filter_type', () => {
    const r = toResult({ slug: 'python', short_description: 'Python', star_count: 9000, filter_type: 'official' });
    expect(r).toEqual({ name: 'python', description: 'Python', official: true, stars: 9000 });
  });

  it('strips the library/ namespace and treats it as official', () => {
    expect(toResult({ slug: 'library/node' }).name).toBe('node');
    expect(toResult({ slug: 'library/node' }).official).toBe(true);
  });

  it('detects official via the Docker Official Images publisher too', () => {
    expect(toResult({ name: 'ubuntu', publisher: { name: 'Docker Official Images' } }).official).toBe(true);
  });

  it('a community repo keeps its namespace and is not official', () => {
    const r = toResult({ slug: 'grafana/grafana', star_count: 100, filter_type: 'community' });
    expect(r.name).toBe('grafana/grafana');
    expect(r.official).toBe(false);
  });

  it('coerces a missing star_count to 0 and falls back across id/name/slug', () => {
    expect(toResult({ id: 'redis' })).toMatchObject({ name: 'redis', stars: 0 });
  });
});
