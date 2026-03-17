// backend/src/transport/WebSocketManager.ts
import { WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';

// Import our IaC Pipeline
import { DockerBuilder } from '../services/DockerBuilder';
import { ConfigParser, DockerGenerator } from '@cloud-ide/shared'; 

// Import our Core OS Architecture
import { SessionManager } from '../core/SessionManager';
import { Container } from '../core/Container';


// this manages connection to our session objects
export class WebSocketManager{
  constructor(private sessionManager: SessionManager) {}

  public async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {

    // search for session id and environment and resolve changes
    const url = new URL(req.url || '', `http://localhost`);
    
    const sessionId = url.searchParams.get('sessionId');
    const envName = url.searchParams.get('env') || 'Default';

    if (!sessionId) {
      ws.send('\r\n\x1b[1;31m[Fatal] Missing sessionId in connection request.\x1b[0m\r\n');
      ws.close();
      return;
    }
  }
}