import { describe, it, expect } from 'vitest';
import { parseCsrfToken } from './apiClient';

describe('parseCsrfToken', () => {
  it('extracts the token from a cookie string', () => {
    expect(parseCsrfToken('csrf-token=abc123')).toBe('abc123');
    expect(parseCsrfToken('session=xyz; csrf-token=abc123; other=1')).toBe('abc123');
    expect(parseCsrfToken('csrf-token=a%2Bb%3Dc')).toBe('a+b=c'); // URL-decoded
  });

  it('returns empty string when absent', () => {
    expect(parseCsrfToken('')).toBe('');
    expect(parseCsrfToken('session=xyz; other=1')).toBe('');
    // must not match a different cookie whose name ends in csrf-token
    expect(parseCsrfToken('x-csrf-token=nope')).toBe('');
  });
});
