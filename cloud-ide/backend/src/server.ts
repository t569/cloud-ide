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

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Allows Express to parse JSON bodies in POST requests

// ==========================================
// THE KERNEL (Dependency Injection)
// ==========================================

// 1. Instantiate the Global Process Registry exactly once
const sessionManager = new SessionManager();

// 2. The Control Plane (HTTP REST API)
// We pass the sessionManager into the router so it can Stop/Destroy containers
app.use('/api/session', createSessionRouter(sessionManager));

// 3. Create the underlying Node HTTP Server
const server = http.createServer(app);

// 4. The Data Plane (WebSockets)
// We pass the EXACT SAME sessionManager to the WebSocket layer
const wss = new WebSocketServer({ server });
const wsManager = new WebSocketManager(sessionManager);

wss.on('connection', (ws, req) => {
  wsManager.handleConnection(ws, req);
});

// ==========================================
// IGNITION
// ==========================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`\x1b[1;32m[Kernel]\x1b[0m Cloud IDE Backend initialized on port ${PORT}`);
});