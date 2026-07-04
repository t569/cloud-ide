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
import { SessionController } from './controllers/SessionController';

// Security middleware (CSRF + IDOR ownership) — SECURITY finding #2
import { csrfProtection } from './api/middleware/security';


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
// CORS: explicit origin + credentials so the browser sends the session cookie.
// A wildcard origin is INCOMPATIBLE with credentials, so this must be specific.
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

// CSRF double-submit protection on every route. Safe (GET/HEAD) requests just
// receive the token cookie; state-changing requests must echo it back in the
// X-CSRF-Token header. The frontend apiClient does this automatically.
app.use(csrfProtection);

// Lets the SPA prime its csrf-token cookie before its first mutating call.
app.get('/api/csrf', (_req, res) => res.status(204).end());


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
const sessionController = new SessionController(systemEvents, sessionRepo, sandboxRepo, sandboxManager);

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

// Session control plane — issues the httpOnly `sid` cookie that /api/fs uses to
// prove sandbox ownership. (Previously defined but never mounted.)
app.post('/api/v1/sessions', sessionController.startSession);
app.delete('/api/v1/sessions/:sessionId', sessionController.disconnectSession);

app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo));

// GARBAGE COLLECTION: RUNS IN THE BACKGROUND
GarbageCollector.init();

// NEW: Mount the Virtual File System routes.
// sessionRepo is injected so the router can enforce sandbox ownership (IDOR).
app.use('/api/fs', createFileSystemRouter(sandboxManager, sessionRepo));

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