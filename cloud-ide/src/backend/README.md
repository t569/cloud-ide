# 📁 Cloud IDE — Backend & Engine

The brains of the Cloud IDE: a Node.js (Express) **API Gateway** that owns all
orchestration and never trusts the client. It drives Alibaba's **OpenSandbox** daemon
over HTTP via a pure-TypeScript engine (`services/sandbox/openSandboxEngine.ts`).

> [!NOTE]
> **There is no Rust in the runtime.** The engine was a napi addon (`src-rust` →
> `index.node`); it did no CPU work and was ported to TypeScript. `src-rust/` is
> legacy and unwired — see [its README](./src-rust/src/README.md). No Rust toolchain
> is needed to run or build the stack.

---

## 🏗️ Subsystems

Each subsystem is decoupled and has its own authoritative doc/header comments.

| Subsystem | Where | What it does |
|---|---|---|
| **API Gateway** | `src/server.ts` | REST + SSE + WebSocket ingress, wiring, lifecycle. Routers own their guards (`router.use('/:sandboxId', requireSandboxOwnership)`), so `server.ts` mounts and never decorates — a new sandbox route is owner-gated by construction. |
| **Security** | `src/api/middleware/{auth,security}.ts` | `auth` = **who** (identity seam: signed httpOnly `uid`); `security` = **what** (CSRF double-submit, `userOwnsSandbox` IDOR, admin token, headers). One-directional dep: `auth` imports from `security`, never the reverse. `userOwnsSandbox` is Express-free so HTTP and the PTY WebSocket upgrade enforce one rule. 👉 **[SECURITY.md](../frontend/src/editor/SECURITY.md)**. |
| **OpenSandbox engine** | `src/services/sandbox/openSandboxEngine.ts` | HTTP client to the OpenSandbox daemon: boot/pause/resume/destroy/exec + endpoint resolution. Pure TS (was the `src-rust` napi addon). Wrapped by `RustEngineClient` (name kept for continuity). |
| **Sandbox drivers** | `src/services/sandbox/drivers/` | `ISandboxDriver` seam — one implementation per provider. Default is `DockerPtyDriver` composed over `RustEngineClient`: lifecycle/exec via the engine, **interactive PTY via `docker exec -it`** (node-pty). Selected by `SANDBOX_DRIVER`. See **[drivers/README.md](./src/services/sandbox/drivers/README.md)** and **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**. |
| **Filesystem / VFS** | `src/services/FileSystemManager.ts`, `src/api/FileSystemRoutes.ts` | Host-direct file I/O against the sandbox's bind-mounted git worktree (no container round-trips, works while PAUSED). Path containment (lexical + symlink) is the trust boundary — [SECURITY #7](../frontend/src/editor/SECURITY.md). |
| **Live file tree** | `src/services/WorkspaceWatchers.ts`, `src/services/FsEventHub.ts` | chokidar on the worktree → coalesced path patches over SSE → the editor patches its tree without clobbering unsaved edits. See [ARCHITECTURE.md](../../ARCHITECTURE.md) Step 10. Its per-sandbox SSE ref-count (`isViewed`) doubles as the "is anyone using this?" signal for the IdleSweeper. |
| **Scale-to-Zero** | `src/services/sandbox/IdleSweeper.ts` | Pauses containers no editor is viewing (liveness = `WorkspaceWatchers.isViewed`, **not** session records), with a `lastActiveAt` grace period so a just-woken sandbox isn't re-paused before its editor attaches. Wake-on-Demand resumes on first traffic. |
| **Terminal** | `src/api/PtyGateway.ts`, `src/controllers/SandboxController.ts` | Two paths: an interactive PTY WebSocket bridge (`/pty`, **live** via `DockerPtyDriver`) and line-mode command streaming (`POST /exec`, **live**). The transport is chosen per driver capability (`GET /v1/sandboxes/capabilities`). See **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**. |
| **Activity log** | `src/database/json/JsonActivityRepository.ts` | Per-sandbox audit trail (created / state / session attach·leave), surfaced in the drawer's Logs tab via `GET /v1/sandboxes/:id/activity`. Sandbox events are recorded in `SandboxManager`; session events in `PersistenceLayer`. |
| **Session control plane** | `src/controllers/SessionController.ts` | `POST /api/v1/sessions` — **the launch path.** Smart-routes a browser connection to compute: reuses this user's warm (`RUNNING`/`PAUSED`) sandbox for the env, resuming it if paused, and cold-boots only when there is none. Keyed on `SandboxRecord.environmentId` (the env id — **never** the image tag, which changes on every content-tagged rebuild). Going to `POST /v1/sandboxes` instead double-provisions. See [ARCHITECTURE.md](../../ARCHITECTURE.md) Step 9e. |
| **Session recovery** | `src/services/SessionStore.ts` | Persists terminal scrollback (crash-safe, outside the worktree) for reconnect/restore. Unrelated to `SessionController` — **two different "sessions"**: a `SessionRecord` is a browser↔sandbox connection, a `SessionStore` entry is one terminal's scrollback. |
| **Build pipeline** | `src/services/builder/` | Environment JSON → built/tagged Docker images with queueing, status, history, rollback. 👉 **[services/builder/README.md](./src/services/builder/README.md)**. |
| **Storage** | `src/services/storage/WorktreeEngine.ts` | One git worktree per sandbox (branch `sbx-<id>`) — the durable, content-addressed source of truth (our Merkle tree + WAL; see ARCHITECTURE.md "Known Debt"). |
| **Health** | `src/api/HealthRoutes.ts` | `GET /api/health` — probes every subsystem above in parallel (daemon, docker, build store, repos, worktrees + `git`, driver) and reports the worst as the overall status. 200 for `ok`/`degraded`, **503** for `down`. Rendered at `/health` in the SPA. 👉 **[HEALTH.md](./HEALTH.md)**. |

### The terminal in one picture

```
xterm ─ createTerminalTransport ─┬─ SseExecTransport ─POST /exec─▶ SandboxController ─ execd (line-mode, LIVE)
                                 └─ WebSocketTransport ─WS /pty─▶ PtyGateway ─ SandboxManager.openTerminalSession
                                                                      └─ DockerPtyDriver.openSession ─ docker exec -it (PTY, LIVE)
```

---

## ⚙️ Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | gateway port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin (must be explicit for credentialed SSE/cookies) |
| `PUBLIC_API_URL` | `http://localhost:3000` | public URL of this server (drives cookie `Secure` flag) |
| `OPENSANDBOX_API_URL` | `http://127.0.0.1:8080` | the OpenSandbox daemon the engine talks to |
| `OPENSANDBOX_API_KEY` | — | OpenSandbox lifecycle API key |
| `OPENSANDBOX_EXECD_ACCESS_TOKEN` | — | token for the in-container execd daemon |
| `AUTH_SECRET` | — (dev: generated) | HMAC key signing the `uid` identity cookie. **Required in production** (boot refuses without it); in dev, generated once and persisted to `data/.auth-secret`. |
| `SANDBOX_DRIVER` | `opensandbox` | driver select: `opensandbox` → `DockerPtyDriver` over the engine (docker-exec PTY, default) \| `alibaba` → `AlibabaSdkDriver` (SDK PTY; unverified scaffold) |
| `BUILD_STORE` | `json` | build store: `json` \| `memory` \| `redis` |
| `MAX_CONCURRENT_BUILDS` | `2` | global build concurrency cap |
| `GATEWAY_TIMEOUT` | `130000` | ms; must exceed `RUST_READ_TIMEOUT` |

---

## 🖥️ Terminal — interactive PTY is live

The default driver (`DockerPtyDriver`) gives every terminal a **real interactive TTY**:
vim/top/colors and a persistent shell, via `docker exec -it sandbox-<id>` wrapped in a
host PTY (node-pty). The frontend reads `GET /v1/sandboxes/capabilities` and, when
`pty` is true, uses the `WebSocketTransport` → `/pty` bridge; otherwise it falls back to
line-mode `SseExecTransport` → `/exec` (a one-shot `execd` command stream, no TTY).

`node-pty` is an **optional** dependency loaded via runtime `require`, so if it isn't
built (`capabilities().pty=false`) the terminal degrades to line-mode instead of failing.
It builds under Linux/WSL (where the stack runs); on Windows it needs VS Build Tools, but
Windows never needs it — `tsc` uses the runtime require, not a static import.

The alternate `AlibabaSdkDriver` (`SANDBOX_DRIVER=alibaba`) is an **unverified scaffold**
that would deliver the PTY over the OpenSandbox SDK instead of docker-exec. Full plan +
wire protocol: **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**.

Still deferred: **PTY reattach across socket drops** (build-order step 6).

---

## 🚀 Running the server

```bash
npm run dev          # from /backend, or `npm run dev:backend` / `npm run dev` at the root
```
Runs `ts-node src/server.ts` — no build step, no Rust. **Nothing works without the
OpenSandbox daemon running** (`OPENSANDBOX_API_URL`): the engine talks to it for every
sandbox operation. `npm run dev` at the repo root also starts that daemon + the frontend.

> [!NOTE]
> Backend is `ts-node` with no auto-reload — restart to pick up backend edits.

## 🧪 Tests

```bash
npm test           # jest unit suites (co-located *.test.ts)
```
Co-located `*.test.ts` are committed; the `__tests__/` integration dir is gitignored. The
end-to-end pipeline test (`npx ts-node src/__tests__/test-api.ts`) needs the server running.

## 📦 Dependencies

```bash
npm install <pkg>            # inside /backend
npm install <pkg> -w backend # from the repo root (workspace flag)
```
