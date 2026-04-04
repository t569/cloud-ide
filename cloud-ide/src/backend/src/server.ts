// backend/src/server.ts
import express from 'express';
import http from 'http';
import cors from 'cors';

// 1. IMPORT OUR CENTRALIZED CONFIG FIRST
import { config } from './config/env';

// Import our Transports (REST Controllers)
import { SandboxController } from './controllers/SandboxController';


// File Routers
import { createFileSystemRouter } from './api/FileSystemRoutes';
import { createEnvironmentRouter } from './api/routes/environment.routes';

// Import our database functionality
import { EventEmitter } from 'events';
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { PersistenceLayer } from './database/PersistenceLayer';

// Docker clean up services
import { GarbageCollector } from './services/builder';

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); 

// Initialize Storage (ROM)
const envRepo = new JsonEnvironmentRepository();
const sessionRepo = new JsonSessionRepository();

// Initialize Central Event Bus
const systemEvents = new EventEmitter();

// Initialize Background Daemon
const persistenceLayer = new PersistenceLayer(systemEvents, sessionRepo);

// Initialize Controllers
const sandboxController = new SandboxController(systemEvents, envRepo, sessionRepo);

// Mount Control Plane (HTTP API Routes)
app.post('/api/sessions/start', sandboxController.startSession);
app.delete('/api/sessions/:sessionId', sandboxController.stopSession);
app.post('/api/sessions/:sessionId/pause', sandboxController.pauseSession);
app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo));

// GARBAGE COLLECTION: RUNS IN THE BACKGROUND
GarbageCollector.init();

// NEW: Mount the Virtual File System routes
app.use('/api/fs', createFileSystemRouter());

// Start the Gateway Server
const server = http.createServer(app);

// 2. USE THE CONFIG OBJECT
server.listen(config.PORT, () => {
  console.log(`\x1b[1;32m[Gateway]\x1b[0m Node API Gateway initialized on port ${config.PORT}`);
});