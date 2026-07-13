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
import { config, assertSecureProductionConfig } from './config/env';

// Fail fast on an insecure multi-tenant config, before we open a port. Mirrors the
// AUTH_SECRET boot-guard: refuse to run rather than run exploitable.
assertSecureProductionConfig();

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
import { createLspRouter } from './api/LspRoutes';
import { LspProxy, parseLspServers } from './services/lsp/LspProxy';
import { createHealthRouter } from './api/HealthRoutes';
import { createPreviewIngress } from './api/PreviewRoutes';
import { isPreviewUpgrade } from './api/previewPath';
import { createEnvironmentRouter } from './api/routes/environment.routes';
import { createImageRouter } from './api/routes/images.routes';
import { attachPtyGateway, isPtyUpgrade } from './api/PtyGateway';

import { EventEmitter } from 'events';
import { JsonEnvironmentRepository } from './database/json/JsonEnvironmentRepository';
import { JsonSandboxRepository } from './database/json/JsonSandboxRepository';
import { JsonSessionRepository } from './database/json/JsonSessionRepository';
import { JsonActivityRepository } from './database/json/JsonActivityRepository';
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
const activityRepo = new JsonActivityRepository();

// Initialize Central Event Bus for Decoupled Mircoservices
const systemEvents = new EventEmitter();

// // Initialize the Kernel & Background Daemons
const persistenceLayer = new PersistenceLayer(systemEvents, sessionRepo, sandboxRepo, activityRepo);
const sandboxDriver = createSandboxDriver();
// `undefined` for worktreeEngine keeps its default; activityRepo is the 4th arg so
// provision/pause/resume/destroy land in the drawer's Activity log. envRepo is the 5th:
// ensureRunning needs it to rebuild a boot spec when it recovers a dead container onto
// its worktree — without it, recovery can't know which image to come back on.
const sandboxManager = new SandboxManager(sandboxRepo, sandboxDriver, undefined, activityRepo, envRepo);

// fsEventHub carries chokidar (Step 10c) change events out over SSE; the watchers'
// per-sandbox SSE ref-count doubles as the "is anyone using this?" signal the
// IdleSweeper reads, so both are constructed before it.
const fsEventHub = new FsEventHub();
const workspaceWatchers = new WorkspaceWatchers(sandboxManager, fsEventHub);

// The IdleSweeper implements our Scale-to-Zero architecture, freezing inactive
// containers to save compute. Must run alongside the Wake-on-Demand Gateway logic.
const idleSweeper = new IdleSweeper(sandboxRepo, sandboxManager, workspaceWatchers);

// Initialize Controllers
const sandboxController = new SandboxController(sandboxManager, sessionRepo, activityRepo);
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
const buildStore = createBuildStore();
const buildService = new BuildService(
  new BuilderRegistry([new DockerBuilder()]),
  buildStore,
  Number(process.env.MAX_CONCURRENT_BUILDS) || 2, // global build concurrency cap
);

app.use('/api/environment', createEnvironmentRouter(envRepo, sandboxRepo, buildService));

// Managers shared by the health probes AND the fs/lsp routers below — constructed
// here (before the health mount) so the dashboard probes the real instances.
const fileSystemManager = new FileSystemManager(sandboxManager);
const sessionStore = new SessionStore();

// Language servers (online LSP). Browser <-debounced HTTP/SSE-> here <-> server.
// Unset => every language reports `offline` and the editor runs on Monaco alone.
//
//   LSP_SERVERS="python=exec:pyright-langserver --stdio;rust=exec:rust-analyzer"
//
// `exec:` runs the server INSIDE the sandbox over docker-exec stdio, so it sees the
// image's own toolchain (venv, node_modules, cargo registry) and speaks /workspace
// paths natively. That's what makes imports resolve. `host:port` instead points at a
// server beside the gateway: it shares this disk (host paths ARE its paths, see
// LspProxy) but is blind to anything installed in the image.
const lspServers = parseLspServers(process.env.LSP_SERVERS);

// The environment is the source of truth: EnvironmentConfig.languageServers named the
// servers, LspInjector baked them into the image, and LspProxy spawns them in-container
// from the same table (shared/languageServers.ts). Resolved once per session, not per
// request — it is not on the hot path.
const envLanguages = async (sandboxId: string): Promise<string[]> => {
  const sandbox = await sandboxRepo.get(sandboxId);
  if (!sandbox?.environmentId) return [];
  const env = await envRepo.get(sandbox.environmentId);
  return env?.builderConfig?.languageServers ?? [];
};

const lspProxy = new LspProxy({
  envLanguages,
  globalServers: lspServers,
  hostPathFor: (sb, p) => fileSystemManager.hostPathFor(sb, p),
  rootHostPath: (sb) => sandboxManager.getWorkspaceHostPath(sb),
  readFile: (sb, p) => fileSystemManager.readFile(sb, p),
  openExecStream: (sb, cmd) => sandboxManager.openExecStream(sb, cmd),
});

// Subsystem health, for humans (/health in the SPA) and for load balancers (503 when
// anything is down). Mounted here — after buildStore exists — so it shares the real
// dependency instances rather than probing lookalikes. It sits behind csrfProtection
// and attachUser, which only means a probe gets handed cookies it can ignore.
app.use('/api/health', createHealthRouter({
  sandboxRepo, envRepo, buildStore, driver: sandboxDriver,
  lspServers, lspSessionCount: () => lspProxy.sessionCount(),
}));

// Docker Hub image/tag search proxy (base-image picker in the env architect).
app.use('/api/images', createImageRouter());

// GARBAGE COLLECTION: RUNS IN THE BACKGROUND
GarbageCollector.init();

// Mount the Virtual File System routes (host-direct against the worktrees) and the
// LSP routes. Both reuse the managers constructed above the health mount. sandboxRepo
// is injected so each router enforces sandbox ownership (IDOR).
app.use('/api/fs', createFileSystemRouter(fileSystemManager, sandboxRepo, fsEventHub, workspaceWatchers, sessionStore));
app.use('/api/lsp', createLspRouter(lspProxy, sandboxRepo));

// NEW: Mount the Ingress Router (Step 3) — proxies browser traffic into sandbox services
const previewIngress = createPreviewIngress(sandboxManager, sandboxRepo);
app.use('/preview', previewIngress.router);

/**
 * 🌟 The Gateway HTTP Server
 * Bootstraps the Express application and binds it to the configured port.
 * The high timeout is managed at the Controller layer for long-running Exec streams.
 */
const server = http.createServer(app);

// Interactive terminal: bridge WS /api/v1/sandboxes/:id/pty → a driver PTY session
// (provider-agnostic; inert until a pty-capable driver is active). See PtyGateway.
attachPtyGateway(server, { sandboxManager, sandboxRepo });

// Preview hot-reload: a dev server's HMR socket, proxied into the sandbox. Each
// upgrade handler ignores paths that aren't its own rather than destroying the
// socket — Node fires EVERY 'upgrade' listener, so a handler that closed anything
// unfamiliar would slam the door on its neighbours (which is precisely why HMR could
// not have worked before: the PTY bridge destroyed every non-PTY upgrade).
server.on('upgrade', (req, socket, head) => {
  if (isPreviewUpgrade(new URL(req.url ?? '', 'http://localhost').pathname)) {
    previewIngress.upgrade(req, socket, head);
  }
});

// ...which means SOMEONE has to close the sockets nobody claimed. Registered last, so
// it runs after both handlers above have had their look.
server.on('upgrade', (req, socket) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  if (!isPtyUpgrade(pathname) && !isPreviewUpgrade(pathname)) socket.destroy();
});

// 2. USE THE CONFIG OBJECT
//
// Listen only once the build store has hydrated. `IBuildStore.begin()` is sync, so a
// build POSTed during the load would be silently erased when hydrate() replaced the
// in-memory mirror — the UI then showed the previous run's "Interrupted by a server
// restart" while docker built in the background. Volatile stores expose no `ready`
// and resolve immediately. The delay is one file read.
(buildStore.ready ?? Promise.resolve())
  .then(() => {
    server.listen(config.PORT, () => {
      console.log(`\x1b[1;32m[Gateway]\x1b[0m Node API Gateway initialized on port ${config.PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Gateway] build store failed to load; refusing to start:', err);
    process.exit(1);
  });


// Set the global Gateway timeout (e.g., 130 seconds)
// This must be slightly higher than RUST_READ_TIMEOUT
const GATEWAY_TIMEOUT = parseInt(process.env.GATEWAY_TIMEOUT || '130000', 10);
server.timeout = GATEWAY_TIMEOUT;