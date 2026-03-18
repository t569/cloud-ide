// backend/src/transport/WebSocketManager.ts
/*
      * The manager for all the requests that come from the frontend
      * This is then queried to a backend session Manager 
      * The session manager handles sessions and containers by coupling and decoupling
      * synonymous to OS mounting and dismounting
      *
      * To find our api routes that we expose to the frontend,
      * check backend/src/api/SessionRoutes.ts
*/

import { WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';

// Import our IaC Pipeline
import { DockerBuilder } from '../services/DockerBuilder';
import { ConfigParser, DockerGenerator } from '@cloud-ide/shared'; 

// Import our Core OS Architecture
import { SessionManager } from '../core/SessionManager';
import { Container } from '../core/Container';

// Import our database services
import { IEnvironmentRepository } from 'src/database/IEnvironmentRepository';
import { ISessionRepository } from 'src/database/ISessionRepository';

// Import our github api
import path from 'node:path';
import { GitProvisioner } from 'src/workspace/GitProvisioner';

import fs from 'node:fs/promises';


// this manages connection to our session objects
// this also imports our database handlers and manages our connections to them
export class WebSocketManager{
  constructor(private sessionManager: SessionManager,
              private envRepo: IEnvironmentRepository,
              private sessionRepo: ISessionRepository
  ) {}

  public async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {

    // search for session id and environment and resolve changes
    const url = new URL(req.url || '', `http://localhost`);
    
    const sessionId = url.searchParams.get('sessionId');
    const envId = url.searchParams.get('env') || 'Default';
    const repoUrl = url.searchParams.get('repo');


    // null guards to handle if we dont pass a session or repo
    if (!sessionId) {
      ws.send('\r\n\x1b[1;31m[Fatal] Missing sessionId in connection request.\x1b[0m\r\n');
      return ws.close();
    }

    if (!repoUrl) {
      ws.send('\r\n\x1b[1;31m[Fatal] Missing GitHub repository URL.\x1b[0m\r\n');
      return ws.close();
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

          // get session from database so we can tell it that we are waking the container up
          const dbSession = await this.sessionRepo.get(sessionId);
          await fs.access(dbSession!.mountPath);


          ws.send(`\r\n\x1b[1;33m[System]\x1b[0m Waking up suspended environment ${sessionId}...\r\n`);
          container.wakeUp();

          // Let the daemon know it's awake
          this.sessionManager.emit('session:status_changed', { sessionId, status: 'LIVE' });
        }
      } else {
        // SCENARIO C: COLD BOOT (Brand new environment)
        ws.send(`\r\n\x1b[1;34m[System]\x1b[0m Allocating new hardware thread for ${sessionId}...\r\n`);

        // 1. Pull real config from the database
        
        const envRecord = await this.envRepo.get(envId);
        if (!envRecord) throw new Error(`Environment ${envId} not found in ROM.`);

        // Generate a deterministic, isolated path on the host server
        const mountPath = path.resolve(__dirname, `../../data/workspaces/${sessionId}`);

        // 2. Build via IaC
        // Pull the physical code to the hard drive BEFORE booting Docker
        await GitProvisioner.cloneRepository(repoUrl, mountPath);

        // Iac main pipeline
        const dockerfileContent = DockerGenerator.generate(envRecord.config);
        const builder = new DockerBuilder(envId, dockerfileContent);
        const imageName = await builder.buildAndStreamLogs(ws);   // stream all the logs into our websocket

        // 3. Register & Boot

        session = this.sessionManager.createSession(sessionId, envId, mountPath);
        container = new Container(sessionId, imageName);
        session.coupleContainer(container);
        container.createAndRun(mountPath);

      }

      // Step 2: Route the I/O Stream
      // Notice how clean this is now. The Session handles grabbing the PTY process internally.
      // our session now has complete control over the stream
      session.attachStream(ws);

      // Step 3: Pipe Data Plane (Frontend -> Docker)
      ws.on('message', (msg: RawData) => {
        try{
          const rawString = msg.toString();
        
          // 1. Parse the incoming JSON from SessionStream
          const parsed = JSON.parse(rawString);

          // 2. Route the command based on its 'type'
          if (parsed.type === 'data') {
            // Route typing directly to the bash terminal
            session!.write(parsed.payload);
          } 
          else if (parsed.type === 'resize') {
            // Route terminal dimensions to the node-pty instance
            session!.resize(parsed.cols, parsed.rows);
            console.log(`\x1b[36m[PTY]\x1b[0m Session ${sessionId} resized to ${parsed.cols}x${parsed.rows}`);
          }
        }catch(err)
        {
          // Fallback: If it's not valid JSON (e.g., someone connecting via a raw tool),
          // we assume it's raw text and try to write it anyway to prevent a crash.
          session!.write(msg.toString());
        }
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

}