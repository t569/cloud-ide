// AudioWorklet: play interleaved Float32 PCM pushed from the main thread.
// (display-streaming stage 2 — the audio transport's browser consumer.)
//
// A ring buffer absorbs WS jitter: the main thread posts decoded frames as they
// arrive; process() drains 128 frames per quantum on the audio render thread.
// Underflow (network hiccup) outputs silence rather than glitching. Runs in
// AudioWorkletGlobalScope — plain JS, no imports.

class PcmPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const channels = (options.processorOptions && options.processorOptions.channels) || 2;
    // ~2s of interleaved headroom; overflow drops oldest (producer is realtime,
    // so this only trips if the tab is badly starved — silence beats unbounded lag).
    const capacity = sampleRate * channels * 2;
    this.channels = channels;
    this.ring = new Float32Array(capacity);
    this.capacity = capacity;
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.port.onmessage = (e) => this.push(e.data);
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (this.size === this.capacity) {
        // overflow: advance read to drop the oldest sample
        this.read = (this.read + 1) % this.capacity;
        this.size--;
      }
      this.ring[this.write] = samples[i];
      this.write = (this.write + 1) % this.capacity;
      this.size++;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const ch = this.channels;
    const frames = out[0].length; // 128
    for (let f = 0; f < frames; f++) {
      if (this.size >= ch) {
        for (let c = 0; c < ch; c++) {
          const v = this.ring[this.read];
          this.read = (this.read + 1) % this.capacity;
          this.size--;
          if (out[c]) out[c][f] = v;
        }
      } else {
        for (let c = 0; c < ch; c++) if (out[c]) out[c][f] = 0; // underflow → silence
      }
    }
    return true; // keep the node alive
  }
}

registerProcessor('pcm-player', PcmPlayer);
