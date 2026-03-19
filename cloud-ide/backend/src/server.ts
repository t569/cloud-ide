// backend/src/server.ts
import express from 'express';
import http from 'http';
import cors from 'cors';

// Import our Transports (REST Controllers)
import { SandboxController } from './controllers/SandboxController';
import { createEnvironmentRouter } from './api/EnvironmentRoutes';

// Import our database functionality
import { EventEmitter } from 'events';
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { PersistenceLayer } from './database/PersistenceLayer';

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Allows Express to parse JSON bodies in POST requests

// 1. Initialize Storage (ROM)
const envRepo = new JsonEnvironmentRepository();
const sessionRepo = new JsonSessionRepository();

// 2. Initialize Central Event Bus (The Nervous System)
const systemEvents = new EventEmitter();

// 3. Initialize Background Daemon
// It listens to systemEvents and saves data to the JSON files automatically
const persistenceLayer = new PersistenceLayer(systemEvents, sessionRepo);

// 4. Initialize Controllers
const sandboxController = new SandboxController(systemEvents, envRepo, sessionRepo);

// 5. Mount Control Plane (HTTP API Routes)
// Booting and destroying OpenSandbox sessions
app.post('/api/sessions/start', sandboxController.startSession);
app.delete('/api/sessions/:sessionId', sandboxController.stopSession);
app.post('/api/sessions/:sessionId/pause', sandboxController.pauseSession);

// Environment CRUD (creating new builder configs, etc.)
app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo));

// 6. Start the Gateway Server
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`\x1b[1;32m[Gateway]\x1b[0m OpenSandbox API Gateway initialized on port ${PORT}`);
});