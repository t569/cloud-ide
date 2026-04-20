// backend/src/server.ts

/**
 * ============================================================================
 * CLOUD IDE: MAIN API GATEWAY
 * ============================================================================
 * This is the central ingress controller. It receives REST/WebSocket traffic from 
 * the frontend, manages persistence, and delegates heavy compute tasks across the 
 * N-API boundary to the Rust Engine.
 */

import express from 'express';
import http from 'http';
import cors from 'cors';

// 1. IMPORT OUR CENTRALIZED CONFIG FIRST
import { config } from './config/env';

// Import our Transports (REST Controllers)
import { SandboxController } from './controllers/SandboxController';
import { AdminController } from './controllers/AdminController';


// File Routers
import { createFileSystemRouter } from './api/FileSystemRoutes';
import { createEnvironmentRouter } from './api/routes/environment.routes';

import { EventEmitter } from 'events';
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSandboxRepository } from './database/json/JsonSandboxRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { PersistenceLayer } from './database/PersistenceLayer';
import { SandboxManager } from './services/sandbox/SandboxManager';
import { IdleSweeper } from './services/sandbox/IdleSweeper';

// Docker clean up services
import { GarbageCollector } from './services/builder';

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); 


// Initialize Persistence Layer
const envRepo = new JsonEnvironmentRepository();
const sessionRepo = new JsonSessionRepository();
const sandboxRepo = new JsonSandboxRepository();

// Initialize Central Event Bus for Decoupled Mircoservices
const systemEvents = new EventEmitter();

// // Initialize the Kernel & Background Daemons
const persistenceLayer = new PersistenceLayer(systemEvents, sessionRepo, sandboxRepo);
const sandboxManager = new SandboxManager(sandboxRepo);

// The IdleSweeper implements our Scale-to-Zero architecture, freezing inactive 
// containers to save compute. Must run alongside the Wake-on-Demand Gateway logic.
const idleSweeper = new IdleSweeper(sessionRepo, sandboxRepo, sandboxManager);

// Initialize Controllers
const sandboxController = new SandboxController(sandboxManager);
const adminController = new AdminController(sandboxManager);

// Mount Control Plane (HTTP API Routes)
app.post('/api/v1/sandboxes', sandboxController.createSandbox);
app.get('/api/v1/sandboxes/:sandboxId', sandboxController.getSandboxStatus);
app.post('/api/v1/sandboxes/:sandboxId/exec', sandboxController.execCommand);
app.post('/api/v1/sandboxes/:sandboxId/pause', sandboxController.pauseSandbox);
app.post('/api/v1/sandboxes/:sandboxId/resume', sandboxController.resumeSandbox);
app.delete('/api/v1/sandboxes/:sandboxId', sandboxController.destroySandbox);
app.post('/api/v1/sandboxes/:sandboxId/volumes', sandboxController.attachVolume);
app.delete('/api/v1/sandboxes/:sandboxId/volumes/:volumeName', sandboxController.detachVolume);
app.delete('/api/v1/admin/sandboxes/:sandboxId', adminController.forceDestroySandbox);
app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo));

// GARBAGE COLLECTION: RUNS IN THE BACKGROUND
GarbageCollector.init();

// NEW: Mount the Virtual File System routes
app.use('/api/fs', createFileSystemRouter(sandboxManager));

/**
 * 🌟 The Gateway HTTP Server
 * Bootstraps the Express application and binds it to the configured port.
 * The high timeout is managed at the Controller layer for long-running Exec streams.
 */
const server = http.createServer(app);

// 2. USE THE CONFIG OBJECT
server.listen(config.PORT, () => {
  console.log(`\x1b[1;32m[Gateway]\x1b[0m Node API Gateway initialized on port ${config.PORT}`);
});


// Set the global Gateway timeout (e.g., 130 seconds)
// This must be slightly higher than RUST_READ_TIMEOUT
const GATEWAY_TIMEOUT = parseInt(process.env.GATEWAY_TIMEOUT || '130000', 10);
server.timeout = GATEWAY_TIMEOUT;