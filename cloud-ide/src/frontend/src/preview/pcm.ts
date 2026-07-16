// PCM decode for the Display pane's audio transport (display-streaming stage 2).
//
// The gateway pipes Xvnc-adjacent PulseAudio's raw s16le stream byte-for-byte, so
// a WS message is an arbitrary slice of it — it can split mid-frame. This converts
// a chunk to interleaved Float32 in [-1,1] and CARRIES the sub-frame remainder to
// the next call, so channel (L/R) parity never drifts across chunk boundaries.
//
// Pure + framing-only so it is unit-testable without an AudioContext; the worklet
// just ring-buffers the Float32 this produces.

/** Tap format — must match the backend's module-simple-protocol-tcp (display.ts). */
export const AUDIO_CHANNELS = 2;

const EMPTY = new Uint8Array(0);

export interface PcmChunkResult {
  /** Interleaved Float32 samples, a whole number of frames. */
  samples: Float32Array;
  /** Bytes left over below one frame, to prepend to the next chunk. */
  leftover: Uint8Array;
}

/**
 * @param bytes      the WS message payload (raw s16le)
 * @param leftover   remainder returned by the previous call (or EMPTY)
 * @param frameBytes bytes per frame = channels * 2 (stereo s16 = 4)
 */
export function pcmChunk(bytes: Uint8Array, leftover: Uint8Array, frameBytes = 4): PcmChunkResult {
  const buf =
    leftover.length === 0
      ? bytes
      : (() => {
          const j = new Uint8Array(leftover.length + bytes.length);
          j.set(leftover, 0);
          j.set(bytes, leftover.length);
          return j;
        })();

  const usable = buf.length - (buf.length % frameBytes); // whole frames only
  const n = usable >> 1; // int16 samples
  const out = new Float32Array(n);
  const view = new DataView(buf.buffer, buf.byteOffset, usable);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;

  const rem = buf.subarray(usable);
  return { samples: out, leftover: rem.length ? new Uint8Array(rem) : EMPTY };
}

export { EMPTY as EMPTY_PCM };
