// backend/src/services/lsp/tcpConnector.ts
//
// Opens the raw stream LspSession speaks over. Today: a plain TCP socket to a
// language server listening on host:port. The SSH tunnel is a drop-in successor
// here — ssh2's `forwardOut()` hands back a Duplex with the identical contract,
// so LspSession never changes. That's the whole point of taking a `Duplex`.

import net from 'node:net';
import type { Duplex } from 'node:stream';

export function connectTcp(host: string, port: number, timeoutMs = 5000): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => onError(new Error(`LSP connect timeout ${host}:${port}`)));
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.setTimeout(0); // connected — drop the connect deadline
      socket.removeListener('error', onError);
      resolve(socket);
    });
  });
}
