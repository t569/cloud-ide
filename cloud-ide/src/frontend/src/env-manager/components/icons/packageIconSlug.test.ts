import { describe, it, expect } from 'vitest';
import { packageIconSlug } from './packageIconSlug';

describe('packageIconSlug', () => {
  const cases: [string, string][] = [
    // plain + version suffixes
    ['tensorflow', 'tensorflow'],
    ['numpy==1.0.0', 'numpy'],
    ['express@4.17.1', 'express'],
    ['serde^1.0', 'serde'],
    // scoped npm
    ['@angular/core', 'angular'],
    ['@angular/core@16.0.0', 'angular'],
    // maven / gradle coordinate -> artifact (NOT treated as a version)
    ['org.springframework:spring-core', 'spring-core'],
    // go module path -> last segment
    ['github.com/gin-gonic/gin', 'gin'],
    // zig tarball URL -> github repo, extension stripped
    ['https://github.com/ziglibs/zfetch/archive/refs/tags/0.1.0.tar.gz', 'zfetch'],
    // aliases toward the full-color logos: names
    ['node', 'nodejs-icon'],
    ['golang', 'go'],
    // empty
    ['', ''],
  ];

  it.each(cases)('%s -> %s', (input: string, expected: string) => {
    expect(packageIconSlug(input)).toBe(expected);
  });
});
