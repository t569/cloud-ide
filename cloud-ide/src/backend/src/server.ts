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
import { csrfProtection, requireAdmin, securityHeaders } from './api/middleware/security';
import { createSandboxRouter } from './api/SandboxRoutes';
import { attachUser } from './api/middleware/auth';


// File Routers
import { createFileSystemRouter } from './api/FileSystemRoutes';
import { createPreviewRouter } from './api/PreviewRoutes';
import { createEnvironmentRouter } from './api/routes/environment.routes';
import { createImageRouter } from './api/routes/images.routes';
import { attachPtyGateway } from './api/PtyGateway';

import { EventEmitter } from 'events';
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSandboxRepository } from './database/json/JsonSandboxRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { PersistenceLayer } from './database/PersistenceLayer';
import { SandboxManager } from './services/sandbox/SandboxManager';
import { createSandboxDriver } from './services/sandbox/drivers/createSandboxDriver';
import { IdleSweeper } from './services/sandbox/IdleSweeper';
import { FileSystemManager } from './services/FileSystemManager';
import { FsEventHub } from './services/FsEventHub';
import { WorkspaceWatchers } from './services/WorkspaceWatchers';
import { SessionStore } from './services/SessionStore';

// Build pipeline (swappable builder + status tracking) and Docker clean up
import {
  GarbageCollector,
  BuildService,
  BuilderRegistry,
  DockerBuilder,
  createBuildStore,
} from './services/builder';

const app = express();

// Middleware
// CORS: explicit origin + credentials so the browser sends the session cookie.
// A wildcard origin is INCOMPATIBLE with credentials, so this must be specific.
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));

// Baseline hardening headers on every response (nosniff / no framing / referrer).
app.use(securityHeaders);

// Explicit body cap. express.json() defaults to 100kb; state it so a future bump
// is a deliberate decision rather than an accident, and so the limit is greppable.
app.use(express.json({ limit: '100kb' }));

// CSRF double-submit protection on every route. Safe (GET/HEAD) requests just
// receive the token cookie; state-changing requests must echo it back in the
// X-CSRF-Token header. The frontend apiClient does this automatically.
app.use(csrfProtection);

// Identity seam: resolves (and on first contact mints) the caller's `uid`.
// MUST come before any route that consults req.userId — i.e. every ownership
// guard below. Replace the body of api/middleware/auth when login lands.
app.use(attachUser);

// Lets the SPA prime its csrf-token AND uid cookies before its first mutating
// call — a cold load that POSTs before ever issuing a GET would otherwise 403.
app.get('/api/csrf', (_req, res) => res.status(204).end());


// Initialize Persistence Layer
const envRepo = new JsonEnvironmentRepository();
const sessionRepo = new JsonSessionRepository();
const sandboxRepo = new JsonSandboxRepository();

// Initialize Central Event Bus for Decoupled Mircoservices
const systemEvents = new EventEmitter();

// // Initialize the Kernel & Background Daemons
const persistenceLayer = new PersistenceLayer(systemEvents, sessionRepo, sandboxRepo);
const sandboxManager = new SandboxManager(sandboxRepo, createSandboxDriver());

// fsEventHub carries chokidar (Step 10c) change events out over SSE; the watchers'
// per-sandbox SSE ref-count doubles as the "is anyone using this?" signal the
// IdleSweeper reads, so both are constructed before it.
const fsEventHub = new FsEventHub();
const workspaceWatchers = new WorkspaceWatchers(sandboxManager, fsEventHub);

// The IdleSweeper implements our Scale-to-Zero architecture, freezing inactive
// containers to save compute. Must run alongside the Wake-on-Demand Gateway logic.
const idleSweeper = new IdleSweeper(sandboxRepo, sandboxManager, workspaceWatchers);

// Initialize Controllers
const sandboxController = new SandboxController(sandboxManager);
const adminController = new AdminController(sandboxManager);
const sessionController = new SessionController(systemEvents, sessionRepo, sandboxRepo, sandboxManager, envRepo);

// Mount Control Plane (HTTP API Routes)
//
// The IDOR guard lives INSIDE each router (`router.use('/:sandboxId', ...)`), not on
// individual routes here — so a route added later is owner-gated by construction
// rather than by memory. See api/SandboxRoutes.ts.
app.use('/api/v1/sandboxes', createSandboxRouter(sandboxController, sandboxRepo));

// God-mode: force-destroy skips the dirty-worktree pre-flight and deletes the
// user's worktree with it. Gated behind a static ADMIN_TOKEN header, and DISABLED
// (404) whenever ADMIN_TOKEN is unset — which is the default. It was previously
// mounted with no authentication whatsoever.
// TODO: make the admin page more fleshed out. build the admin system
app.delete('/api/v1/admin/sandboxes/:sandboxId', requireAdmin, adminController.forceDestroySandbox);

// Session control plane — issues the httpOnly `sid` cookie that /api/fs uses to
// prove sandbox ownership. (Previously defined but never mounted.)
app.post('/api/v1/sessions', sessionController.startSession);
app.delete('/api/v1/sessions/:sessionId', sessionController.disconnectSession);

// Build pipeline: Docker today, swappable via the registry. The build store is
// config-driven ($BUILD_STORE: json (default) | memory | redis). To use Redis,
// pass a client here: createBuildStore({ backend: 'redis', redis: myClient }).
const buildService = new BuildService(
  new BuilderRegistry([new DockerBuilder()]),
  createBuildStore(),
  Number(process.env.MAX_CONCURRENT_BUILDS) || 2, // global build concurrency cap
);

app.use('/api/environment', createEnvironmentRouter(envRepo, sessionRepo, buildService));

// Docker Hub image/tag search proxy (base-image picker in the env architect).
app.use('/api/images', createImageRouter());

// GARBAGE COLLECTION: RUNS IN THE BACKGROUND
GarbageCollector.init();

// NEW: Mount the Virtual File System routes (host-direct against the worktrees).
// sandboxRepo is injected so the router can enforce sandbox ownership (IDOR).
// fsEventHub / workspaceWatchers are constructed above (the IdleSweeper needs them).
const fileSystemManager = new FileSystemManager(sandboxManager);
const sessionStore = new SessionStore();
app.use('/api/fs', createFileSystemRouter(fileSystemManager, sandboxRepo, fsEventHub, workspaceWatchers, sessionStore));

// NEW: Mount the Ingress Router (Step 3) — proxies browser traffic into sandbox services
app.use('/preview', createPreviewRouter(sandboxManager, sandboxRepo));

/**
 * 🌟 The Gateway HTTP Server
 * Bootstraps the Express application and binds it to the configured port.
 * The high timeout is managed at the Controller layer for long-running Exec streams.
 */
const server = http.createServer(app);

// Interactive terminal: bridge WS /api/v1/sandboxes/:id/pty → a driver PTY session
// (provider-agnostic; inert until a pty-capable driver is active). See PtyGateway.
attachPtyGateway(server, { sandboxManager, sandboxRepo });

// 2. USE THE CONFIG OBJECT
server.listen(config.PORT, () => {
  console.log(`\x1b[1;32m[Gateway]\x1b[0m Node API Gateway initialized on port ${config.PORT}`);
});


// Set the global Gateway timeout (e.g., 130 seconds)
// This must be slightly higher than RUST_READ_TIMEOUT
const GATEWAY_TIMEOUT = parseInt(process.env.GATEWAY_TIMEOUT || '130000', 10);
server.timeout = GATEWAY_TIMEOUT;