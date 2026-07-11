// backend/src/services/lsp/framing.ts
//
// The LSP base protocol frames every JSON-RPC message with a header:
//
//   Content-Length: <N>\r\n\r\n<N bytes of UTF-8 JSON>
//
// This is the ONLY bug-prone part of talking to a language server over a raw
// stream (TCP, SSH tunnel, or a child process's stdio all look identical here):
// a single socket `data` event can carry a partial frame, several frames, or a
// frame split mid-header. Keep the parsing in one tested place; everything above
// deals in plain JS objects.

/** Serialize a JSON-RPC message into a length-prefixed frame. */
export function encodeMessage(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, json]);
}

/**
 * Accumulates raw stream bytes and yields whole JSON-RPC messages as they
 * complete. Bytes for a not-yet-complete frame stay buffered until the rest
 * arrives — so callers just `append(chunk)` then drain whatever is ready.
 */
export class MessageBuffer {
  // ArrayBufferLike (not the narrower ArrayBuffer that Buffer.alloc infers) so
  // socket chunks and Buffer.concat results assign cleanly under strict types.
  private buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  append(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  /** Yields every complete message currently buffered, consuming those bytes. */
  *drain(): Generator<any> {
    for (;;) {
      const headerEnd = this.buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return; // header not fully arrived

      const header = this.buf.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const bodyStart = headerEnd + 4;

      if (!match) {
        // Unparseable header — drop it so one bad frame can't wedge the stream.
        this.buf = this.buf.subarray(bodyStart);
        continue;
      }

      const length = Number(match[1]);
      if (this.buf.length < bodyStart + length) return; // body still incoming

      const body = this.buf.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buf = this.buf.subarray(bodyStart + length);
      try {
        yield JSON.parse(body);
      } catch {
        // Skip a corrupt body; the byte cursor has already advanced past it.
      }
    }
  }
}
