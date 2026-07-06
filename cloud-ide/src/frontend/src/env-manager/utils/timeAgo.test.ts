import { describe, it, expect } from 'vitest';
import { timeAgo } from './timeAgo';

describe('timeAgo', () => {
  const now = 1_700_000_000_000;
  it('picks the right unit across thresholds', () => {
    expect(timeAgo(now, now)).toMatch(/now/); // numeric:auto -> "now"
    expect(timeAgo(now - 5_000, now)).toContain('second');
    expect(timeAgo(now - 2 * 3600_000, now)).toContain('hour');
    expect(timeAgo(now - 3 * 86400_000, now)).toContain('day');
    expect(timeAgo(now - 400 * 86400_000, now)).toContain('year');
  });
});
