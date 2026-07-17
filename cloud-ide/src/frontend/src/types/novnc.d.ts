// Minimal typings for the surface DisplayPane uses. @novnc/novnc ships no types;
// the full API is core/rfb.js — extend this as more of it is used.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: Element,
      urlOrChannel: string | WebSocket,
      options?: { credentials?: { password?: string }; shared?: boolean },
    );
    disconnect(): void;
    /** Scale the remote framebuffer to fit the container element. */
    scaleViewport: boolean;
    /** CSS background behind/around the framebuffer. */
    background: string;
    viewOnly: boolean;
    /** Tight JPEG quality, 0–9 (higher = crisper, more bytes). */
    qualityLevel: number;
    /** zlib level for non-JPEG regions, 0–9 (0 = none; less CPU, more bytes). */
    compressionLevel: number;
  }
}
