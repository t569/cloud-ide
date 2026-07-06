import { describe, it, expect } from 'vitest';
import { toDockerSafeId, toImageName } from '@cloud-ide/shared';

// Full docker image-reference shape (optional :tag). If a slug ever produces a
// leading/trailing/repeated separator this regex fails — which is exactly the
// "invalid reference format" a real `docker build` would reject.
const VALID_REF = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[\w.-]+)?$/;

describe('toDockerSafeId / toImageName', () => {
  it('slugifies without mangling into invalid ids', () => {
    const cases: [string, string][] = [
      ['ZKP Noir Dev', 'zkp-noir-dev'],
      ['my__env', 'my-env'],
      ['  spaced  ', 'spaced'],
      ['a--b', 'a-b'],
      ['-leading-trailing-', 'leading-trailing'],
      ['UPPER.case', 'upper-case'],
    ];
    for (const [input, expected] of cases) {
      expect(toDockerSafeId(input)).toBe(expected);
    }
  });

  it('always yields a valid docker image reference', () => {
    for (const raw of ['ZKP Noir', '!!!', 'a--b', '   ', 'ok', '-']) {
      expect(toImageName(raw)).toMatch(VALID_REF);
    }
  });

  it('is idempotent on an already-safe id', () => {
    const once = toDockerSafeId('Weird__Name!!');
    expect(toDockerSafeId(once)).toBe(once);
  });
});
