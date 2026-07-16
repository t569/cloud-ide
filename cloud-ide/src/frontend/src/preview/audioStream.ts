// Audio transport client (display-streaming stage 2): opens the /display/audio
// WS, decodes raw s16le with pcmChunk, and feeds the pcm-player AudioWorklet.
// One function, one teardown handle — DisplayPane's speaker toggle owns the
// lifecycle. Decoupled from the RFB video path entirely.
import { API_BASE_URL } from '../config/env';
import { AUDIO_CHANNELS, pcmChunk, EMPTY_PCM } from './pcm';
// Vite emits the worklet as an asset; addModule loads it into the audio thread.
import workletUrl from './pcmPlayer.worklet.js?url';

export interface AudioHandle {
  stop: () => void;
}

function audioUrl(sandboxId: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/v1/sandboxes/${encodeURIComponent(sandboxId)}/display/audio`;
}

/**
 * Start playing the sandbox's audio. Resolves once the WS is open and the
 * worklet is wired; rejects if the WS fails to open (no audio stack / tap down).
 */
export async function connectAudio(sandboxId: string): Promise<AudioHandle> {
  // 44.1k matches the tap; a mismatched ctx rate would resample every quantum.
  const ctx = new AudioContext({ sampleRate: 44100 });
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'pcm-player', {
    outputChannelCount: [AUDIO_CHANNELS],
    processorOptions: { channels: AUDIO_CHANNELS },
  });
  node.connect(ctx.destination);

  const ws = new WebSocket(audioUrl(sandboxId));
  ws.binaryType = 'arraybuffer';
  let leftover: Uint8Array<ArrayBufferLike> = EMPTY_PCM;
  ws.onmessage = (e) => {
    const { samples, leftover: rem } = pcmChunk(new Uint8Array(e.data as ArrayBuffer), leftover, AUDIO_CHANNELS * 2);
    leftover = rem;
    if (samples.length) node.port.postMessage(samples, [samples.buffer]);
  };

  const stop = () => {
    try { ws.close(); } catch { /* already closed */ }
    node.disconnect();
    void ctx.close();
  };
  ws.onclose = () => node.disconnect();

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      void ctx.resume(); // autoplay policy: a user gesture (the toggle) precedes this
      resolve();
    };
    ws.onerror = () => reject(new Error('Audio stream failed to open.'));
  });

  return { stop };
}
