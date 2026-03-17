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

    try {
      // Step 1: Query the Process Registry
      let session = this.sessionManager.getSession(sessionId);
      let container = session?.getContainer();

      // If we have both a session and container
      if (session && container) {
        if (container.isLive) {
          // SCENARIO A: HOT HIJACK (Container is already running)
          ws.send(`\r\n\x1b[1;32m[System]\x1b[0m Hijacking active execution thread for session ${sessionId}...\r\n`);
        } else {
          // SCENARIO B: WARM BOOT (Container is asleep, needs to be woken up)
          ws.send(`\r\n\x1b[1;33m[System]\x1b[0m Waking up suspended environment ${sessionId}...\r\n`);
          container.wakeUp();
        }
      } else {
        // SCENARIO C: COLD BOOT (Brand new environment)
        ws.send(`\r\n\x1b[1;34m[System]\x1b[0m Allocating new hardware thread for ${sessionId}...\r\n`);

        // 1. Fetch & Compile the Infrastructure
        const rawJsonConfig = await this.fetchConfigFromDB(envName);
        const validatedConfig = ConfigParser.parseAndValidate(rawJsonConfig);
        const dockerfileContent = DockerGenerator.generate(validatedConfig);

        // 2. Build the Docker Image
        const builder = new DockerBuilder(envName, dockerfileContent);
        const imageName = await builder.buildAndStreamLogs(ws);   // stream all the logs into our websocket

        // 3. Register the Process & Allocate Hardware
        session = this.sessionManager.createSession(sessionId);
        container = new Container(sessionId, imageName);
        session.coupleContainer(container);

        // 4. Boot the Container and Mount Filesystem 
        // TODO: Replace this string in Step 2 when we build the Storage Module
        const temporaryMountPath = '/tmp/fake-github-repo'; 
        container.createAndRun(temporaryMountPath);
      }

      // Step 2: Route the I/O Stream
      // Notice how clean this is now. The Session handles grabbing the PTY process internally.
      // our session now has complete control over the stream
      session.attachStream(ws);

      // Step 3: Pipe Data Plane (Frontend -> Docker)
      ws.on('message', (msg: RawData) => {
        session!.write(msg.toString()); 
      });

      // Step 4: Handle Disconnects gracefully, not session ends
      ws.on('close', () => {
        console.log(`[Transport] Socket dropped for session ${sessionId}. Suspending process.`);
        // We suspend it in memory, allowing for Hot Hijacks if the user refreshes.
        this.sessionManager.handleDecouple(sessionId, 'LEAVE_RUNNING'); 
      });


    }catch (err: any) {
      ws.send(`\r\n\x1b[1;31m[Kernel Panic] Infrastructure Error: ${err.message}\x1b[0m\r\n`);
    }
  }


  /**
   * STUB: This will eventually connect to your database to pull saved environments.
   * Right now, it returns a hardcoded config to satisfy the ConfigParser.
   */
  private async fetchConfigFromDB(envName: string): Promise<string> {
    return JSON.stringify({ 
      baseImage: 'node:18-bullseye', 
      system: ['curl', 'git'], 
      languages: {} 
    });
  }
}