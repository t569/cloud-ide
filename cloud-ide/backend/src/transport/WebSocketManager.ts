/* src/transport/WebSocketManager.ts
*/

import { WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { DockerBuilder } from '../services/DockerBuilder';
// import { ConfigParser, DockerGenerator } from '@cloud-ide/shared'; // FIX this


// Import our new Core Architecture
import { SessionManager } from '../core/SessionManager';
import { Container } from '../core/Container';

export class WebSocketManager{
  // We inject the global SessionManager (The Hashmap) into the websocket router
  constructor(private sessionManager: SessionManager) {}

  public async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '', `http://localhost`);

    // The frontend MUST pass a sessionId now so we can track the coupling
    const sessionId = url.searchParams.get('sessionId');
    const envName = url.searchParams.get('env');

    if (!sessionId) {
      ws.send('\r\n\x1b[1;31mError: Missing sessionId in connection request.\x1b[0m\r\n');
      ws.close();
      return;
    }

    try{
      // Workflow goes here
    }catch (err: any) {
      ws.send(`\r\n\x1b[1;31mInfrastructure Error: ${err.message}\x1b[0m\r\n`);
    }
  }

  private async fetchConfigFromDB(envName: string): Promise<string> {
    // return a default environment config
    return JSON.stringify({ baseImage: 'node:18-bullseye', system: [], languages: {} });
  }
}