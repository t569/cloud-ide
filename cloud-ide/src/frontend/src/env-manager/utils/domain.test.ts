import { describe, it, expect } from 'vitest';
import { normalizeDomain } from './domain';

describe('normalizeDomain', () => {
  it('leaves a bare host alone', () => {
    expect(normalizeDomain('api.example.com')).toBe('api.example.com');
  });

  it('trims and lowercases', () => {
    expect(normalizeDomain('  API.Example.COM  ')).toBe('api.example.com');
  });

  it('strips a pasted scheme and path', () => {
    expect(normalizeDomain('https://api.example.com/webhooks/v1')).toBe('api.example.com');
    expect(normalizeDomain('http://x.io')).toBe('x.io');
  });

  it('keeps a wildcard', () => {
    expect(normalizeDomain('*.example.com')).toBe('*.example.com');
  });

  it('returns empty for blank input', () => {
    expect(normalizeDomain('   ')).toBe('');
  });
});
