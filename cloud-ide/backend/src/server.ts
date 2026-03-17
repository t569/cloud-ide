// backend/src/server.ts
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

// Import our Core OS Architecture
import { SessionManager } from './core/SessionManager';

// Import our Transports (REST & WebSockets)
import { WebSocketManager } from './transport/WebSocketManager';
import { createSessionRouter } from './api/SessionRoutes'; 
import { createEnvironmentRouter } from './api/EnvironmentRoutes';
import { createFileSystemRouter } from './api/FileSystemRoutes';

// Import our database functionality
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { PersistenceLayer } from './database/PersistenceLayer';


const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Allows Express to parse JSON bodies in POST requests

// 1. Initialize Storage (ROM)
// TODO: pass in a string for the path of our database JSON files
const envRepo = new JsonEnvironmentRepository();
const sessionRepo = new JsonSessionRepository();

// 2. Initialize Core Kernel (RAM)
const sessionManager = new SessionManager();

// 3. Initialize Background Daemon
const persistenceLayer = new PersistenceLayer(sessionManager, sessionRepo);

// 4. Mount Control Plane (HTTP API)
// We pass the sessionManager into the router so it can Stop/Destroy containers
app.use('/api/session', createSessionRouter(sessionManager)); // the session manager is also passed here and we can do stuff with it
app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo)); // this helps with environments
app.use('/api/fs', createFileSystemRouter(sessionRepo));    // this helps with changes to the file structure

// 5. Mount Data Plane (WebSockets)
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const wsManager = new WebSocketManager(sessionManager, envRepo, sessionRepo);

wss.on('connection', (ws, req) => {
  wsManager.handleConnection(ws, req);  // initialises the sessions and container stuff: IT ALL STARTS HERE!
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`\x1b[1;32m[Bootloader]\x1b[0m IDE OS initialized on port ${PORT}`);
});
