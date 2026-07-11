import { encodeMessage, MessageBuffer } from './framing';

describe('LSP framing', () => {
  it('round-trips a message through encode + drain', () => {
    const buf = new MessageBuffer();
    buf.append(encodeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect([...buf.drain()]).toEqual([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  });

  it('reassembles a frame split across arbitrary chunk boundaries', () => {
    const whole = encodeMessage({ id: 7, result: 'ok' });
    const buf = new MessageBuffer();
    // Feed it one byte at a time — nothing drains until the last byte lands.
    for (let i = 0; i < whole.length - 1; i++) {
      buf.append(whole.subarray(i, i + 1));
      expect([...buf.drain()]).toEqual([]);
    }
    buf.append(whole.subarray(whole.length - 1));
    expect([...buf.drain()]).toEqual([{ id: 7, result: 'ok' }]);
  });

  it('yields multiple messages coalesced into one chunk', () => {
    const buf = new MessageBuffer();
    buf.append(Buffer.concat([encodeMessage({ id: 1 }), encodeMessage({ id: 2 })]));
    expect([...buf.drain()]).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('encodes the byte length, not the character count (UTF-8 safe)', () => {
    // JSON `{"s":"café"}` is 12 characters but 13 bytes — é is 2 bytes in UTF-8.
    const frame = encodeMessage({ s: 'café' });
    expect(frame.toString('ascii', 0, frame.indexOf('\r\n'))).toBe('Content-Length: 13');
  });
});
