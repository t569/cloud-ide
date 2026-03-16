// src/transport/WebSocketManager.ts
import { WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { TerminalSession } from '../services/TerminalSession';
import { DockerBuilder } from '../services/DockerBuilder'; // We will rewrite this next!

// Import our new shared infrastructure engine
import { ConfigParser, DockerGenerator } from '@cloud-ide/shared';

export class WebSocketManager {
  
  public async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '', `http://${host}`);

    // TODO: handle database integration to pull the JSON config for this env
    const envName = url.searchParams.get('env');
    
    try {
      // preset this if we have no image
      let imageName = 'ubuntu:latest';

      if (envName && envName !== 'Default') {
        // --- THE NEW IaC PIPELINE ---
        
        // 1. Simulate fetching the raw JSON from your database
        // (For now, we will assume you fetch a raw string based on envName)
        const rawJsonConfig = await this.fetchConfigFromDB(envName); 

        // 2. Validate the state using our semantic analyzer
        const validatedConfig = ConfigParser.parseAndValidate(rawJsonConfig);

        // 3. Compile the actual Dockerfile instructions
        const dockerfileContent = DockerGenerator.generate(validatedConfig);

        // 4. Phase 1 Execution: Pass the compiled Dockerfile to the builder
        const builder = new DockerBuilder(envName, dockerfileContent);
        
        // Stream the compilation logs directly to the user's terminal
        imageName = await builder.buildAndStreamLogs(ws); 
      }

      // Phase 2: Start the Terminal (Delegated to our new TerminalSession)
      const terminal = new TerminalSession(imageName);
      
      // Phase 3: Wire the streams together (The Interrupt Hooks)

      // takes our data from the ptyprocess onData data capture
      // checks if our connection is available 
      // then send it through the channel back to docker stream
      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
      
      // Route incoming messages from the frontend to the terminal
      ws.on('message', (msg: RawData) => this.routeMessage(msg, terminal));
      
      // Clean up the process when the socket drops
      ws.on('close', () => {
        console.log(`🔴 Disconnected. Killing container ${imageName}...`);
        terminal.kill();
      });

    } catch (err: any) {
      console.error("Workflow failed:", err);
      // Send the error to the frontend terminal in red text
      ws.send(`\r\n\x1b[1;31mInfrastructure Error: ${err.message}\x1b[0m\r\n`);
    }
  }

  /**
   * Parses incoming WebSocket binary/text data and routes it to the terminal buffer.
   */
  private routeMessage(message: RawData, terminal: TerminalSession): void {
    const msgStr = message.toString();
    
    if (msgStr.startsWith('{"type":"resize"')) {
      try {
        const { cols, rows } = JSON.parse(msgStr);
        terminal.resize(cols, rows);
      } catch (e) {
        console.error("Failed to parse resize payload");
      }
    } else {
      terminal.write(msgStr);
    }
  }

  /**
   * Placeholder for your future Database fetch logic.
   */
  private async fetchConfigFromDB(envName: string): Promise<string> {
    // Eventually, this will be: return await db.collection('environments').findOne({ name: envName });
    return JSON.stringify({
      baseImage: 'node:18-bullseye',
      system: [],
      languages: {}
    });
  }
}