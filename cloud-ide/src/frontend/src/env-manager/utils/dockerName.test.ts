import { describe, it, expect } from 'vitest';
import {
  isValidId,
  validateName,
  slugify,
  toImageName,
  generateId,
  generateFriendlyName,
  resolveNewNaming,
} from '@cloud-ide/shared';

// Full docker image-reference shape (optional :tag). A leading/trailing/repeated
// separator here is exactly the "invalid reference format" a real build rejects.
const VALID_REF = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[\w.-]+)?$/;
const RFC1123 = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

describe('naming — validity', () => {
  it('slugifies to valid RFC 1123 labels without mangling', () => {
    const cases: [string, string][] = [
      ['ZKP Noir Dev', 'zkp-noir-dev'],
      ['my__env', 'my-env'],
      ['  spaced  ', 'spaced'],
      ['a--b', 'a-b'],
      ['-leading-trailing-', 'leading-trailing'],
      ['café crème', 'cafe-creme'],
    ];
    for (const [input, expected] of cases) {
      expect(slugify(input)).toBe(expected);
      expect(RFC1123.test(expected)).toBe(true);
    }
  });

  it('caps slug length at 63 and never ends on a separator', () => {
    const s = slugify('x'.repeat(80) + '   tail');
    expect(s.length).toBeLessThanOrEqual(63);
    expect(s.endsWith('-')).toBe(false);
  });

  it('validates display names', () => {
    expect(validateName('  ok ')).toEqual({ ok: true, value: 'ok' });
    expect(validateName('').ok).toBe(false);
    expect(validateName('x'.repeat(101)).ok).toBe(false);
  });

  it('toImageName is valid and refuses unsafe ids', () => {
    expect(toImageName('env-7f3a9c2b1d')).toMatch(VALID_REF);
    expect(() => toImageName('Bad Id!')).toThrow();
  });
});

describe('naming — generation & policy', () => {
  it('generates valid opaque ids and friendly names', () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidId(generateId())).toBe(true);
      expect(RFC1123.test(generateFriendlyName())).toBe(true);
    }
  });

  it('resolveNewNaming: uses a valid name, invents one when blank, rejects invalid', () => {
    const named = resolveNewNaming('My ZK Prover');
    expect(named.name).toBe('My ZK Prover');
    expect(named.slug).toBe('my-zk-prover');
    expect(isValidId(named.id)).toBe(true);

    const auto = resolveNewNaming('');
    expect(auto.name.length).toBeGreaterThan(0);
    expect(isValidId(auto.id)).toBe(true);

    expect(() => resolveNewNaming('x'.repeat(101))).toThrow();
  });

  it('mints a unique id per environment (identity != label)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(ids.size).toBe(200);
  });
});
