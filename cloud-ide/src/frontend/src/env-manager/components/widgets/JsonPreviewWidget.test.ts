import { describe, it, expect } from 'vitest';
import { highlightJson } from './JsonPreviewWidget';

// The only risk in the tokenizer is a regex gap that silently drops characters.
// Reconstruct the text from tokens and require it to equal the input, byte for byte.
const textOf = (node: unknown): string =>
  typeof node === 'string'
    ? node
    // token spans are React elements: { props: { children } }
    : String((node as { props?: { children?: string } })?.props?.children ?? '');

describe('highlightJson', () => {
  it('never drops characters', () => {
    const samples = [
      '{"id":"","ok":true,"n":-3.5,"arr":[1,2],"s":"a\\"b"}',
      JSON.stringify({ name: 'ZKP', baseImage: 'ubuntu:22.04', steps: [{ isGlobal: false }] }, null, 2),
      '{}',
    ];
    for (const s of samples) {
      const rebuilt = highlightJson(s).map(textOf).join('');
      expect(rebuilt).toBe(s);
    }
  });
});
