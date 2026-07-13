import { parsePreviewHost, isPreviewHost, previewHostFor } from './previewHost';

describe('parsePreviewHost', () => {
  it('parses a UUID sandbox id and port from the first label', () => {
    expect(parsePreviewHost('e72f4917-466f-47c4-a89f-6764bcd88505-3000.localhost:3000')).toEqual({
      sandboxId: 'e72f4917-466f-47c4-a89f-6764bcd88505',
      port: 3000,
    });
  });

  it('ignores the gateway host suffix (dev and prod)', () => {
    expect(parsePreviewHost('sbx-5173.localhost')).toEqual({ sandboxId: 'sbx', port: 5173 });
    expect(parsePreviewHost('sbx-8080.preview.example.com')).toEqual({ sandboxId: 'sbx', port: 8080 });
  });

  it('is not fooled by an id whose last segment is hex ending in digits', () => {
    // The trailing `-<digits>` is the port; the id keeps its own hyphens.
    expect(parsePreviewHost('a1b2-99ff-3000.localhost')).toEqual({ sandboxId: 'a1b2-99ff', port: 3000 });
  });

  it('returns null for the gateway host itself and other non-preview hosts', () => {
    expect(parsePreviewHost('localhost:3000')).toBeNull();
    expect(parsePreviewHost('api.example.com')).toBeNull();
    expect(parsePreviewHost('sbx-notaport.localhost')).toBeNull();
    expect(parsePreviewHost(undefined)).toBeNull();
  });

  it('isPreviewHost mirrors parse', () => {
    expect(isPreviewHost('sbx-3000.localhost')).toBe(true);
    expect(isPreviewHost('localhost:3000')).toBe(false);
  });

  it('build then parse round-trips', () => {
    const host = previewHostFor('sbx-abc', 5173, 'localhost:3000');
    expect(host).toBe('sbx-abc-5173.localhost:3000');
    expect(parsePreviewHost(host)).toEqual({ sandboxId: 'sbx-abc', port: 5173 });
  });
});
