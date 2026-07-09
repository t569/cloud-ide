# 📁 Cloud IDE — Backend & Engine

The brains of the Cloud IDE: a Node.js (Express) **API Gateway** plus a Rust **N-API
execution engine** (`index.node`) that drives Alibaba's OpenSandbox. The gateway
never trusts the client and owns all orchestration; the Rust engine owns the FFI to
the sandbox runtime.

---

## 🏗️ Subsystems

Each subsystem is decoupled and has its own authoritative doc/header comments.

| Subsystem | Where | What it does |
|---|---|---|
| **API Gateway** | `src/server.ts` | REST + SSE + WebSocket ingress, wiring, lifecycle. |
| **Rust Engine** | `src-rust/` → `index.node` | FFI to the OpenSandbox daemon: boot/pause/resume/destroy/exec. See [`src-rust/src/README.md`](./src-rust/src/README.md), [`OPENSANDBOX_IMPL.md`](./src-rust/src/engine/OPENSANDBOX_IMPL.md). |
| **Sandbox drivers** | `src/services/sandbox/drivers/` | `ISandboxDriver` seam — one implementation per provider. `RustEngineClient` (default; exec-only) and `AlibabaSdkDriver` (adds interactive PTY; **scaffold, unverified**). Selected by `SANDBOX_DRIVER`. See **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**. |
| **Filesystem / VFS** | `src/services/FileSystemManager.ts`, `src/api/FileSystemRoutes.ts` | Host-direct file I/O against the sandbox's bind-mounted git worktree (no container round-trips, works while PAUSED). Path containment (lexical + symlink) is the trust boundary — [SECURITY #7](../frontend/src/editor/SECURITY.md). |
| **Live file tree** | `src/services/WorkspaceWatchers.ts`, `src/services/FsEventHub.ts` | chokidar on the worktree → coalesced path patches over SSE → the editor patches its tree without clobbering unsaved edits. See [ARCHITECTURE.md](../../ARCHITECTURE.md) Step 10. |
| **Terminal** | `src/api/PtyGateway.ts`, `src/controllers/SandboxController.ts` | Two paths: line-mode command streaming (`POST /exec`, **live**) and an interactive PTY WebSocket bridge (`/pty`, **built, awaiting a PTY driver**). See **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**. |
| **Session recovery** | `src/services/SessionStore.ts` | Persists terminal scrollback (crash-safe, outside the worktree) for reconnect/restore. |
| **Build pipeline** | `src/services/builder/` | Environment JSON → built/tagged Docker images with queueing, status, history, rollback. 👉 **[services/builder/README.md](./src/services/builder/README.md)**. |
| **Storage** | `src/services/storage/WorktreeEngine.ts` | One git worktree per sandbox (branch `sbx-<id>`) — the durable, content-addressed source of truth (our Merkle tree + WAL; see ARCHITECTURE.md "Known Debt"). |

### The terminal in one picture

```
xterm ─ createTerminalTransport ─┬─ SseExecTransport ─POST /exec─▶ SandboxController ─ execd (line-mode, LIVE)
                                 └─ WebSocketTransport ─WS /pty─▶ PtyGateway ─ SandboxManager.openTerminalSession
                                                                      └─ ISandboxDriver.openSession (PTY; needs a pty-capable driver)
```

---

## ⚙️ Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | gateway port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin (must be explicit for credentialed SSE/cookies) |
| `PUBLIC_API_URL` | `http://localhost:3000` | public URL of this server (drives cookie `Secure` flag) |
| `OPENSANDBOX_API_URL` | `http://127.0.0.1:8080` | the OpenSandbox daemon the Rust engine + SDK talk to |
| `OPENSANDBOX_API_KEY` | — | OpenSandbox lifecycle API key |
| `OPENSANDBOX_EXECD_ACCESS_TOKEN` | — | token for the in-container execd daemon |
| `SANDBOX_DRIVER` | `opensandbox` | driver: `opensandbox` (Rust kernel, exec-only) \| `alibaba` (adds PTY — see requirement below) |
| `BUILD_STORE` | `json` | build store: `json` \| `memory` \| `redis` |
| `MAX_CONCURRENT_BUILDS` | `2` | global build concurrency cap |
| `GATEWAY_TIMEOUT` | `130000` | ms; must exceed `RUST_READ_TIMEOUT` |

---

## 🚧 Outstanding requirement — interactive PTY is not live yet

The terminal today is **line-mode** (`SseExecTransport` → `/exec`): commands run, output
streams, but there's **no interactive TTY** (no vim/top) and **no persistent shell** (each
command is a fresh `sh -c`). This is a hard limit of `execd` (one-shot `POST /command`, no
stdin/PTY, and it's an external prebuilt daemon).

The whole interactive chain (`WebSocketTransport` → `PtyGateway` → `ISandboxDriver.openSession`)
**is built and tested**, waiting on one thing: a **PTY-capable driver**. `AlibabaSdkDriver` is
that driver, but it's an **unverified scaffold**. To make interactive terminals live:

1. `npm i @alibaba-group/opensandbox` in this backend (the SDK is dynamic-imported).
2. Run the OpenSandbox server and point `OPENSANDBOX_API_URL` at it.
3. Validate/fix `AlibabaSdkDriver.openSession` against a live sandbox (the `TODO(validate)`
   markers: **the connect endpoint** — likely a per-sandbox endpoint, not the API root — plus
   server-side auth and the process-exit event).
4. `SANDBOX_DRIVER=alibaba`, and flip the frontend `createTerminalTransport` to `pty:true`.

Also deferred until a live PTY exists: **PTY reattach across socket drops** (build-order step 6)
— it needs a real session to keep alive, so it pairs with the validated driver.

Full plan + contracts: **[TERMINAL_BACKEND.md](./TERMINAL_BACKEND.md)**.

---

> [!CAUTION]
> ### ⚠️ Critical Setup: The Rust Toolchain
> The backend uses `napi-rs` to bridge Node.js and Rust; the compilation is strict. On
> Windows you **MUST** use the MSVC toolchain, or Node throws `Module did not self-register`.

**Verify:**
1. 64-bit Node: `node -p "process.arch"` → `x64`.
2. MSVC Rust: `rustup default stable-x86_64-pc-windows-msvc`.

## 🚀 Running the server

```bash
# From /backend — unified script that avoids "ghost binary" caching.
npm run dev
```
Runs `build:rust` (`scripts/build-rust.mjs`: pick the Rust target matching this Node's
ABI, clean stale `index.node`, `napi build`, then require the result to prove it loads) →
`ts-node src/server.ts` (start the gateway). **Nothing works without the OpenSandbox server
running** (`OPENSANDBOX_API_URL`) — the Rust engine talks to it for every sandbox operation.

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
cd src-rust && cargo add <crate>   # Rust crates
```
