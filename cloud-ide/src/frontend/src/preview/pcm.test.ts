import { describe, it, expect } from 'vitest';
import { pcmChunk, EMPTY_PCM } from './pcm';

/** Build a Uint8Array of little-endian s16 samples. */
function s16(...samples: number[]): Uint8Array {
  const b = new Uint8Array(samples.length * 2);
  const v = new DataView(b.buffer);
  samples.forEach((s, i) => v.setInt16(i * 2, s, true));
  return b;
}

describe('pcmChunk', () => {
  it('converts s16le to Float32 in [-1,1]', () => {
    const { samples, leftover } = pcmChunk(s16(0, 32767, -32768), EMPTY_PCM, 2 /* mono frame */);
    expect(leftover.length).toBe(0);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBeCloseTo(0.99997, 4);
    expect(samples[2]).toBe(-1);
  });

  it('carries a sub-frame remainder so L/R parity survives a mid-frame split', () => {
    // Stereo (frameBytes=4). First chunk = 1.5 frames worth of bytes: L0 R0 L1
    // (6 bytes) → only the whole frame [L0,R0] emits; L1's 2 bytes are held back.
    const first = pcmChunk(s16(100, 200, 300), EMPTY_PCM, 4);
    expect(Array.from(first.samples)).toEqual([100, 200].map((x) => x / 32768));
    expect(first.leftover.length).toBe(2); // the pending L1 sample

    // Second chunk supplies R1; the carried L1 must pair with it, not shift parity.
    const second = pcmChunk(s16(400), first.leftover, 4);
    expect(Array.from(second.samples)).toEqual([300, 400].map((x) => x / 32768));
    expect(second.leftover.length).toBe(0);
  });

  it('holds everything when given less than one frame', () => {
    const { samples, leftover } = pcmChunk(new Uint8Array([1, 2, 3]), EMPTY_PCM, 4);
    expect(samples.length).toBe(0);
    expect(leftover.length).toBe(3);
  });
});
