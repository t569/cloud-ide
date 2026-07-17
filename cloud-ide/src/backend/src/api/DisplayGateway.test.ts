// The WS↔TCP bridge is the load-bearing part of the display seam: bytes must pass
// through unmodified in both directions, and either side closing must close both.
import { EventEmitter } from 'node:events';
import { bridge, isDisplayUpgrade } from './DisplayGateway';

// Minimal fakes matching the surface bridge() touches.
class FakeWs extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: Buffer[] = [];
  closed = false;
  bufferedAmount = 0;                 // client backpressure gauge (O3)
  private pending: (() => void)[] = [];
  send(data: Buffer, _opts?: unknown, cb?: () => void) {
    this.sent.push(Buffer.from(data));
    if (cb) this.pending.push(cb);
  }
  /** Fire the queued send callbacks, as ws does once bytes flush to the socket. */
  flush() { const cbs = this.pending; this.pending = []; cbs.forEach((cb) => cb()); }
  close() { this.closed = true; this.readyState = 3; }
}
class FakeTcp extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  paused = false;
  write(data: Buffer) { this.written.push(Buffer.from(data)); }
  destroy() { this.destroyed = true; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  isPaused() { return this.paused; }
}

describe('DisplayGateway.bridge', () => {
  it('pipes bytes both ways unmodified', () => {
    const ws = new FakeWs();
    const tcp = new FakeTcp();
    bridge(ws as any, tcp as any);

    ws.emit('message', Buffer.from([0x52, 0x46, 0x42])); // "RFB" client hello
    tcp.emit('data', Buffer.from([0x01, 0x02]));

    expect(Buffer.concat(tcp.written)).toEqual(Buffer.from([0x52, 0x46, 0x42]));
    expect(Buffer.concat(ws.sent)).toEqual(Buffer.from([0x01, 0x02]));
  });

  it('closing either side tears down both', () => {
    const ws = new FakeWs();
    const tcp = new FakeTcp();
    bridge(ws as any, tcp as any);
    ws.emit('close');
    expect(tcp.destroyed).toBe(true);

    const ws2 = new FakeWs();
    const tcp2 = new FakeTcp();
    bridge(ws2 as any, tcp2 as any);
    tcp2.emit('close');
    expect(ws2.closed).toBe(true);
  });

  it('pauses the container read when the client falls behind, resumes on drain (O3)', () => {
    const ws = new FakeWs();
    const tcp = new FakeTcp();
    bridge(ws as any, tcp as any);

    // Client can't keep up: send buffer climbs past the high-water mark.
    ws.bufferedAmount = 5 * 1024 * 1024;
    tcp.emit('data', Buffer.from([0xff]));
    expect(tcp.isPaused()).toBe(true); // throttled — no unbounded buffering

    // Client drains below the low-water mark; the flush callback lets reads resume.
    ws.bufferedAmount = 0;
    ws.flush();
    expect(tcp.isPaused()).toBe(false);
  });

  it('recognizes both media transports and nothing else', () => {
    // Both must be claimed here, else server.ts's unclaimed-socket closer destroys them.
    expect(isDisplayUpgrade('/api/v1/sandboxes/abc-123/display/stream')).toBe(true);
    expect(isDisplayUpgrade('/api/v1/sandboxes/abc-123/display/audio')).toBe(true);
    expect(isDisplayUpgrade('/api/v1/sandboxes/abc-123/pty')).toBe(false);
    expect(isDisplayUpgrade('/api/v1/sandboxes/abc-123/display/bogus')).toBe(false);
  });
});
