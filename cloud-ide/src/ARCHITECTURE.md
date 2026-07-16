# ☁️ Cloud IDE Architecture & Implementation Plan (v2.0)

## 🗺️ Documentation Map

Where each part of the system is documented. Paths are relative to `src/`.

**Start here**
- [`README.md`](./README.md) — clone → running stack, the host checks, the one ordered path.
- `ARCHITECTURE.md` (this file) — the system overview and the phase/step roadmap.

**Backend — the API gateway**
- [`backend/README.md`](./backend/README.md) — the gateway's shape and responsibilities.
- [`backend/HEALTH.md`](./backend/HEALTH.md) · [`backend/LSP.md`](./backend/LSP.md) · [`backend/TERMINAL_BACKEND.md`](./backend/TERMINAL_BACKEND.md) — health board, language servers, terminal transport.
- [`backend/.../sandbox/network/README.md`](./backend/src/services/sandbox/network/README.md) — **egress policy + tenant isolation** (what a sandbox can reach, how to add domains).
- [`backend/.../sandbox/drivers/README.md`](./backend/src/services/sandbox/drivers/README.md) — the provider-agnostic sandbox driver seam.
- [`backend/.../builder/README.md`](./backend/src/services/builder/README.md) — image build pipeline.
- [`opensandbox/README.md`](./opensandbox/README.md) — the OpenSandbox daemon (what it is, the API we speak).

**Frontend — the IDE**
- [`frontend/README.md`](./frontend/README.md) — the SPA's shape.
- [`frontend/src/editor/README.md`](./frontend/src/editor/README.md) + [`SECURITY.md`](./frontend/src/editor/SECURITY.md) — Monaco editor + VFS wiring, and its trust boundary.
- [`frontend/src/env-manager/README.md`](./frontend/src/env-manager/README.md) — the environment architect UI.
- [`frontend/src/terminal/README.md`](./frontend/src/terminal/README.md) — the xterm terminal + link routing.
- [`frontend/src/vfs/README.md`](./frontend/src/vfs/README.md) + [`VFS.md`](./VFS.md) — the virtual file system (client + host-direct model).
- [`frontend/src/pages/README.md`](./frontend/src/pages/README.md) — the top-level routes.

**Shared & pipeline**
- [`shared/README.md`](./shared/README.md) — the DTOs/types shared across gateway, frontend, and daemon.
- [`pipeline/README.md`](./pipeline/README.md) — the Dockerfile-generation pipeline.

**Plans** — approved implementation plans live in [`docs/plans/`](./docs/plans/) (e.g. the egress/network layer).

---

## Phase 1: Completed Infrastructure (The Foundation)

### 1. The Kernel Space (Rust Execution Engine)
* **Status: ✅ Complete**
* **Files:** `src-rust/src/engine/mod.rs`, `lib.rs`, `opensandbox.rs`
* **What we built:** A highly performant FFI bridge using N-API. We implemented an asynchronous `SandboxEngine` trait that manages the container lifecycle via Alibaba's OpenSandbox, solving complex routing issues and cross-language payload boundaries.

### 2. The User Space (Node.js API Gateway)
* **Status: ✅ Complete**
* **Files:** `SandboxManager.ts`, `SandboxController.ts`, `IdleSweeper.ts`, `rustClient.ts`
* **What we built:** The orchestration layer with a background daemon for **Scale-to-Zero** resource optimization and a **Wake-on-Demand** interception pattern.

### 3. The Terminal UI (React + xterm.js)
* **Status: ✅ Complete**
* **Files:** `Terminal.tsx`, `TerminalTabs.tsx`, `TerminalEventBus.ts`
* **What we built:** A decoupled, event-driven terminal multiplexer that handles concurrent sessions without destroying the WebGL canvas.

### 4. The Contextual UI (Link/File Sniffing)
* **Status: ✅ Complete**
* **Files:** `LinkSnifferPluggin.ts`, `IdeLinkProvider.ts`, `TerminalContextWidget.tsx`
* **What we built:** A reactive HUD that listens to terminal output, intercepts clicks on local development ports/files, and broadcasts them via the Event Bus.

---

## Phase 2: Implementation Roadmap (Product Features)

### Step 1: The Storage Engine (Git Worktrees)
* **Status: ✅ Complete**
* **Files:** `WorktreeEngine.ts`, `WorktreeStrategy.ts`, `SandboxManager.ts`
* **Pending Polish:**
  * [x] **1a.** Add a self-healing loop in `IdleSweeper`: if Rust reports 404 NOT_FOUND, delete orphaned DB records and clean up the worktree.
  * [x] **1b.** Implement a pre-flight check in `destroySandbox`: reject termination (409) if the Git worktree is dirty (unless `?force=true`). Admin route always forces.

### Step 2: Build the File System API (VFS)
* **Status: ✅ Complete**
* **Files:** `FileSystemManager.ts`, `FileSystemRoutes.ts` (mounted at `/api/fs/:sandboxId/...`)
  * [x] **2a.** `GET /api/fs/:sandboxId/read?path=...` (base64-safe file content).
  * [x] **2b.** `POST /api/fs/:sandboxId/write` (save file content, auto-mkdir).
  * [x] **2c.** `GET /api/fs/:sandboxId/ls?path=...` (flat per-directory listing; sidebar lazy-loads children — add a recursive `/tree` only if that hurts).
  * [x] **2d.** `createFileSystemRouter` mounted on the Express gateway.

### Step 3: Implement the Ingress Router (Reverse Proxy)
* **Status: ✅ Complete**
* **Files:** `PreviewRoutes.ts` (mounted at `/preview/:sandboxId/:port`)
  * [x] **3a.** `http-proxy-middleware` ingress. Path-based routing (`/preview/:sandboxId/:port`) instead of wildcard subdomains — same proxy core, switch the router to `req.headers.host` once real DNS exists. WebSocket upgrade (HMR) not wired yet.
  * [x] **3b.** Resolves internal container IPs from the `SandboxManager` record per request.
  * [x] **3c.** Wake-on-Demand: PAUSED sandboxes are resumed before traffic is proxied.

### Step 4: Real WebSocket Transport
* **Status: ✅ Complete**
* **Files:** `WebSocketTransport.ts`, `SseExecTransport.ts`
  * [x] **4a.** `WebSocketTransport.ts` implemented in the frontend.
  * [x] **4b.** `SseExecTransport.ts` connects the terminal to the Gateway's real SSE exec stream (line-mode with local echo — not a PTY; interactive programs need a WS PTY bridge when execd supports it).
  * [x] **4c.** Auto-reconnection with exponential backoff in `WebSocketTransport`.

### Step 5: The Preview Panel (Iframe)
* **Status: ✅ Complete**
* **Files:** `preview/PreviewPane.tsx`
  * [x] **5a.** `PreviewPane.tsx` with an `<iframe>`.
  * [x] **5b.** Listens for `PREVIEW_URL` events on `TerminalEventBus`; `IdeWorkspace` link clicks emit the proxied `/preview/...` URL.
  * [x] **5c.** UI chrome: address bar + reload button.

### Step 6: File System Sync in the Editor
* **Status: ✅ Complete** (re-architected)
* **Files:** `editor/core/{EditorEventBus,VFSController}.ts`, `editor/components/EditorWorkspace.tsx`,
  `editor/hooks/{useWorkspaceBootstrap,useWorkspaceLayout,usePanelResize}.ts`, `vfs/VirtualFileSystem.ts`
  * [x] **6a.** File click routes through the `EditorEventBus` → `VFSController` → VFS engine (`/api/fs` routes).
  * [x] **6b.** `Ctrl+S` / Save-All flushes the dirty queue via `VFSController.forceSync()`.
  * **Note:** the original single-file autosave path (`api/vfs.js`, `WorkspaceEditor`, legacy
    `pages/IDEWorkspace.jsx`) was **replaced** by the event-bus/VFSController editor and deleted.
    `EditorWorkspace` is now a thin shell booted from a `WorkspaceSession` (see Phase 3). Progress
    log: `src/frontend/src/editor/REFACTOR.md`.

### Step 7: End-to-End Integration & Polish
* **Status: ❌ Not Started**
* **Goal:** Production readiness.
  * [ ] **7a.** Unify async boundary error handling.
  * [ ] **7b.** Add loading skeletons.
  * [ ] **7c.** Write deployment runbook.

---

## Phase 3: The Session Lifecycle (Setup → Env → Editor → Resume)

The editor is now a thin shell booted from a `WorkspaceSession { sandboxId, workspaceName?,
envConfig?, snapshot?, plugins? }` (`editor/types/editor.d.ts`). Today `pages/AppShell.tsx`
switches between the env-manager and the editor with a native `useState` view + a dev "Boot
Editor" button. Phase 3 turns that seam into the real product flow:

```
/setup ──▶ /environments (EnvManager) ──build/load──▶ /editor/:sandboxId ◀──resume── /sandboxes
                                              │                                          ▲
                                              └────────── WorkspaceSession ──────────────┘
```

### Step 8: URL Routing & Navigation  ⭐ (do first — everything below deep-links through it)
* **Status: ✅ Complete**
* **Why:** distinct endpoints give us browser back/forward, deep-linking to a specific
  sandbox/editor, shareable snapshot URLs (`SNAPSHOT_CREATED.shareableUrl` already exists in the
  type), and query-driven boot (`?env=`, `?snapshot=`). The old `useState` switch couldn't be
  linked to or refreshed.
* **Decision (done):** a **minimal native History-API router** — `pages/router.tsx` exposes
  `useLocation()` (via React 19 `useSyncExternalStore`) + `navigate()`, **zero deps**. Upgrade to
  `react-router` only when routes nest or need loaders. ponytail: no dependency for a flat table.
* **Routes:** `/environments` (default) · `/editor/:sandboxId` (booted editor) · `/sandboxes`
  (Step 12). `/setup` is reserved for its step.
* **Files:** `pages/router.tsx` (primitives), `pages/AppShell.tsx` (route→page matcher),
  `pages/Environments.tsx` (env-manager + temp dev boot → `navigate('/editor/dev-sandbox')`).
  * [x] **8a.** Native router: `useLocation()` + `navigate()`, `popstate` + synthetic
    `locationchange` wired; `AppShell` matches `/editor/:sandboxId` and defaults to `/environments`.
  * [x] **8b.** `AppShell` parses `:sandboxId` and constructs the `WorkspaceSession` for
    `pages/IDEWorkspace`. `?snapshot=` is a reserved seam until Step 11.
  * [x] **8c.** URL is the single source of truth, so a refresh restores the view. **Prod note:**
    a static host needs SPA fallback (rewrite unknown paths → `index.html`); the Vite dev server
    already does this.

### Step 9: Deep Env-Manager → Editor Boot Wiring
* **Status: ✅ Complete**
* **Goal:** replace the dev "Boot Editor" button — env-manager launches a built environment, which
  provisions a sandbox and navigates to `/editor/:sandboxId` with the full `WorkspaceSession`.
* **Files:** `api/sandbox.ts` (`POST /api/v1/sessions` → `{ sessionId, sandboxId }`), `pages/sessionStore.ts`
  (warm-boot session bridge), `pages/Environments.tsx` (launch + `navigate`),
  `env-manager/components/{EnvManager,MyEnvironments}.tsx` (router-agnostic `onLaunch`),
  `pages/AppShell.tsx` (`getSession`), `backend/controllers/SessionController.ts` (smart routing).
  * [x] **9a.** `startSession(env.id)` → `POST /api/v1/sessions` → `SessionController.startSession`
    returns the `sandboxId`. Launch is disabled until the env has a built image (and the backend
    409s on an unbuilt env regardless).
  * [x] **9b.** `Environments.handleLaunch` stashes the session and `navigate('/editor/:sandboxId')`.
    EnvManager exposes `onLaunch?` only — it stays decoupled from routing + provisioning.
  * [x] **9c.** Session carries `envConfig` + `workspaceName`; the editor surfaces the env name in
    the top bar (`SET_WORKSPACE_NAME`). **Env vars** are applied at container boot via
    `SandboxSpec.envVars` — the correct layer; the terminal/exec inherits them, so no per-exec
    injection. `SessionController` reads them off the env record (`builderConfig.env`) at provision
    time; the client no longer passes them. (Showing `baseImage` in the status bar is cosmetic and
    rides with the wider StatusBar wiring, still mock.)
  * [x] **9d.** Provisioning gate: `waitForRunning` (`api/sandbox.ts`) polls `GET /api/v1/sandboxes/:id`
    until `RUNNING` before entering the editor; a sticky toast covers the wait, errors/timeouts abort
    with a toast. Cheap on a warm reuse — returns on the first poll. See `editor/README.md` → Design Notes.
  * [x] **9e.** **Launch goes through the session layer, never `POST /v1/sandboxes` directly.**
    `POST /v1/sandboxes` is the raw *create compute* verb: `SandboxManager.provision` unconditionally
    cuts a new worktree and boots a new container. Launching through it meant leaving the editor and
    clicking Launch again ran a **second container for the same environment**. `SessionController`
    is the layer that prevents this — `getSandboxesByEnvId` → reuse a warm (`RUNNING`|`PAUSED`)
    sandbox **owned by the caller**, resuming it if paused, and cold-boot only when there is none.
    It was written, mounted (`server.ts`), and then never called. The frontend `createSandbox()`
    wrapper is **deleted** so the footgun cannot be picked up again.
    Three latent bugs on that path, fixed with the switch:
    1. The `PAUSED` branch was a commented-out `// wake()` no-op — a reused paused sandbox never
       reached `RUNNING`, so `waitForRunning` timed out.
    2. The image was resolved as `toImageName(envId)` → `:latest`, which need not exist: builds may
       tag by content (`toImageName(id, contentTag(config))`). It now uses the stored
       `environment.imageName`, which is what a rollback retags.
    3. **The reuse key never matched.** `provision()` stamped `SandboxRecord.environmentId =
       spec.imageTag`, but `getSandboxesByEnvId` queries by *env id*. No record ever matched, so
       reuse silently never fired and 9e would not actually have fixed anything. `SandboxSpec` now
       carries an explicit `environmentId` (falling back to the tag for the raw `POST /v1/sandboxes`
       verb, which has no environment, and which strips a body-supplied one so a caller cannot graft
       an arbitrary image into an env's reuse group). The tag could never have been the key anyway:
       it changes on every content-tagged rebuild.
    Self-checks: `backend/__tests__/session-controller.test.ts` (reuse / resume / no cross-user
    adoption / 409 unbuilt / stored id == queried id) and `sandbox-manager.test.ts` (env id is the
    reuse key, tag fallback).

### Step 10: Backend FS Watcher → Live Tree (chokidar)  — paired with `editor/README.md` Phase 5
* **Status: ✅ Complete** (10a–d done). The Tier-1 dirty-preserving refresh shipped as **10d** below:
  the watcher now pushes the exact changed paths and the client patches surgically, so a disk change
  no longer needs the coarse "skip while dirty" guard.
* **Goal:** active backend mutations (`npm install`, `git`, `touch`) reflect in the tree without a
  manual refresh. The frontend can't know `npm install` changed 10k files — the backend must tell it.
* **Blocker uncovered:** the frontend VFS was fully **mocked** (`hydrateWorkspace`/`flushSyncQueue`
  were `setTimeout`s), and there is **no push channel** (backend is plain Express — the terminal uses
  SSE, there is no WS server). So Step 10 is a dependency chain, not a single watcher:
  * [x] **10a. Real VFS read + write (Phase 5 prereq).** `hydrateWorkspace()` recursively walks
    `GET /api/fs/:id/ls` (children in parallel) to build the tree; `readFile()` lazy-loads blobs via
    `/read`; `flushSyncQueue()` persists edits via `POST /write` + `DELETE /delete` (the mock merkle
    `git-sync` push was dropped — no such backend endpoint). Paths stay in the container space
    (`/workspace/...`) end to end. `frontend/src/vfs/VirtualFileSystem.ts`. *Last-write-wins — no
    optimistic-concurrency/conflict protocol yet.*
  * [x] **10b. Push channel (SSE).** `FsEventHub` (per-sandbox EventEmitter pub/sub) +
    `GET /api/fs/:id/events` (SSE, behind the IDOR guard, with heartbeat). Frontend: `VFSController`
    opens an `EventSource` (`withCredentials`) and updates the tree, emitting `VFS_TREE_UPDATED`.
    **Guard (fallback path only):** the coarse `reload_tree` re-hydrate is still skipped while
    `vfs.hasPendingSync()` — it clears the map and would clobber unsaved edits. The `patch` path (10d)
    has no such guard because it is dirty-preserving. No new dep, no WS upgrade. Files:
    `backend/services/FsEventHub.ts`, `backend/api/FileSystemRoutes.ts`, `server.ts`,
    `frontend/editor/core/VFSController.ts`, `frontend/vfs/VirtualFileSystem.ts`.
  * [x] **10c. chokidar watcher.** `WorkspaceWatchers` (`backend/services/`): **demand-driven** —
    ref-counted per SSE subscriber (acquire on connect, release on last disconnect), so we never
    watch an unviewed workspace and resumed/persisted sandboxes work without provision hooks. Watches
    the host worktree, debounced (300ms), ignores `node_modules`/`.git`, only tree-shape events
    (`add`/`unlink`/`addDir`/`unlinkDir` — not `change`, avoiding self-write echo) → `hub.publish`.
    Full chain: chokidar → `FsEventHub` → SSE → `EventSource` → `VFSController` re-hydrate →
    `VFS_TREE_UPDATED`.
  * [x] **10d. Path-level patch (Tier-1 dirty-preserving refresh).** The watcher coalesces its
    debounce window to one entry per path (`coalesce()` in `FsEventHub.ts` — the atomic hot path) and
    publishes `{ action:'patch', changes:[{kind,path}] }` instead of a blunt `reload_tree`. The client
    applies it via `VirtualFileSystem.applyPatch()`: **adds** insert only if absent (never overwrite a
    local/optimistic node); **unlinks** drop the node/subtree but **skip any dirty node** — so a disk
    delete never yanks unsaved work. Result: the explorer stays live even with unsaved edits open.
    Self-checks: `FsEventHub.test.ts` (coalesce), `VirtualFileSystem.patch.test.ts` (dirty-preserve).

### Step 11: Snapshots (File Tree + Terminal/Sandbox Context)
* **Status: ❌ Not Started**  (frontend contract stubbed: `WorkspaceSnapshot`, `SNAPSHOT_*` events,
  `ISerializable<T>` in `editor/types/editor.d.ts`)
* **Prereq shipped — always-on terminal recovery (Gap B), distinct from shareable snapshots.**
  A terminal's live state (cwd, env, processes) lives *inside the container* and survives pause/resume
  with it; the one thing it doesn't hold is the **scrollback** the user sees. `SessionStore`
  (`backend/services/SessionStore.ts`) persists that per terminal to `data/sessions/<sandboxId>/<terminalId>.json`
  via the existing crash-safe `writeJsonAtomic` — kept **outside** the git worktree so it never dirties
  `git status`. Routes `GET|POST /api/fs/:id/session` ride the sandbox-ownership guard. Frontend:
  `useSessionPersistence` (a `TerminalPanel` hook) POSTs `serializeState()` on a 10s interval +
  `beforeunload`, and on mount restores via the terminal's existing `initialState`/`write()` seam — the
  durable replacement for the localStorage pattern in `Terminal.tsx`. Opt in per session by setting
  `TerminalSession.sessionKey = `${sandboxId}:${terminalId}``. Shareable point-in-time snapshots (below)
  remain unbuilt; this only covers crash/reconnect recovery.
* **Goal:** capture a resumable, shareable point-in-time: open files + view state, the file/folder
  structure, and terminal/sandbox context — space/speed efficient.
* **Design:** prefer a **content-addressed / copy-on-write** capture over a full tarball — reuse the
  Git-worktree storage engine (`WorktreeEngine.ts`) so a snapshot is a commit/ref, not a copy. Terminal
  context via `@xterm/addon-serialize` (already a dep). Metadata (open files, active file, layout) is a
  small JSON blob keyed by snapshot id; restore rebuilds a `WorkspaceSession.snapshot`.
  * [ ] **11a.** Backend `POST /api/snapshots/:sandboxId` → worktree commit/ref + JSON metadata; returns id + `shareableUrl`.
  * [ ] **11b.** `GET /api/snapshots/:id` → restore payload; editor boots via `WorkspaceSession.snapshot`.
  * [ ] **11c.** Frontend: wire the existing `SNAPSHOT_CREATE_REQUESTED` / `SNAPSHOT_LOAD_REQUESTED` bus events.
  * [ ] **11d.** TTL/expiry (`WorkspaceSnapshot.expiresAt`) + GC of expired snapshot refs.

### Step 12: Sandboxes Page — Resume Live/Paused
* **Status: ✅ Complete**
* **Goal:** a `/sandboxes` page listing the user's live + PAUSED sandboxes; clicking one navigates to
  `/editor/:sandboxId`, resuming it. Reuses the **Wake-on-Demand** resume already built for the proxy
  (Step 3c) — a paused sandbox is resumed on first traffic.
* **Note:** this page is a *navigation surface*, not the duplicate-container fix. Reaching an existing
  sandbox from a list is a detour around double-provisioning; **9e** is what actually prevents it, on
  the Launch path itself.
* **Files:** `pages/Sandboxes.tsx`, `pages/launch.ts` (shared launch flow), `pages/AppShell.tsx` (route),
  `api/sandbox.ts` (`listSandboxes`), `backend/controllers/SandboxController.ts` (`listSandboxes`),
  `backend/services/sandbox/SandboxManager.ts` (`listForOwner`).
  * [x] **12a.** `GET /api/v1/sandboxes` → `{ sandboxId, environmentId, state, createdAt, lastActiveAt }[]`,
    scoped to the caller via `SandboxManager.listForOwner` (reuses the existing `ISandboxRepository.list()`).
    No `ownsSandbox` guard: it has no `:sandboxId` to own and filters by identity instead. Returns stored
    state, not a live engine poll — N sandboxes would be N FFI round-trips, and staleness is harmless
    because opening one routes through `startSession`, which resumes it.
  * [x] **12b.** `pages/Sandboxes.tsx` grid (status pills: live / starting / paused / stopped / error) →
    `launchEnvironment(sbx.environmentId)`. **Opening a sandbox is expressed as "connect me to its
    environment"**, so the page cannot bypass warm-reuse/resume — there is one way into the editor.
  * [x] **12c.** Resume on open — **done via 9e**: `SessionController.startSession` resumes a `PAUSED`
    sandbox before returning it, and `waitForRunning` covers the "resuming…" wait with a toast.
    Wake-on-Demand (3c) still covers proxy traffic.
  * [x] **12d.** `EnvManager` gains an `onViewSandboxes?` prop (same router-agnostic seam as `onLaunch`);
    `Sandboxes` links back to `/environments`. **Editor → back is the browser's own back button** — the
    router is History-API based (Step 8), so a bespoke nav control would duplicate a native affordance.

**Order taken:** 8 (routing) → 9 (env→editor) → 10 (FS events) → 12 (resume page). **Step 11 (snapshots)
is all that remains** of Phase 3 — the heaviest lift, and it leans on the worktree engine.

---

## ⚠️ Known Debt

### IdleSweeper liveness — ✅ FIXED (was wrong in both directions)
`IdleSweeper` used to ask `SessionRepository` whether a sandbox had active sessions. `ACTIVE →
DISCONNECTED` is only written by the `session:disconnected` event, emitted solely by
`DELETE /api/v1/sessions/:sessionId` — **which nothing calls.** So the predicate was never meaningful:

* **Before 9e:** the frontend never called `POST /v1/sessions`, so `sessionRepo` was empty, every sandbox
  matched `activeSessions.length === 0`, and the sweeper paused *everything* — including the workspace you
  were actively typing in. Wake-on-Demand (3c) papered over it for proxy traffic.
* **After 9e:** every launch persisted an `ACTIVE` `SessionRecord` that was never cleared, so `isIdle` was
  never true and **nothing was ever paused.** Scale-to-Zero silently died.

**Fix — reuse the ref-count that already exists, don't hand-roll a heartbeat.** Liveness is "does a browser
currently hold this workspace open", and `WorkspaceWatchers` already ref-counts exactly that: one SSE
subscriber per open `GET /api/fs/:id/events` (Step 10c), acquired on connect, released on last disconnect —
tab close and crash included, because the socket dies with them. `WorkspaceWatchers.isViewed(sandboxId)` is
now the sweeper's only liveness input; `sessionRepo` is out of its constructor entirely, and
`SessionRecord.state` is no longer load-bearing for the compute lifecycle.

**Plus a grace period.** `SandboxRecord.lastActiveAt` is stamped on `provision()` and `resume()`, and the
sweeper skips anything younger than `IDLE_GRACE_MS` (default 2 min). Without it, a sweep landing between
`resume()` returning and the editor's SSE attaching re-pauses the sandbox — and `waitForRunning` spins on
`PAUSED` (not a terminal state) until it times out, so the launch the user is waiting on fails.
Records predating the field fall back to `createdAt`.

Self-check: `backend/__tests__/idle-sweeper.test.ts` (viewed / unviewed / grace / legacy record).
**Single-node assumption:** the ref-count is in-process, like `FsEventHub`'s pub/sub. If the gateway ever
fans out across nodes, both move to shared state together.

### Authorization is on the hot path — keep `sandboxRepo.get()` O(1)
`userOwnsSandbox` → `sandboxRepo.get()` runs on **every guarded request**: each `/api/fs/:id/*` call,
and each proxied asset through `/preview/:id/:port`. `JsonSandboxRepository` used to `fs.readFile` +
`JSON.parse` the entire database per call — **~1.07 ms of synchronous, event-loop-blocking work** at
200 sandboxes, scaling with total DB size rather than with the caller. One preview page pulling 50
assets stalled the loop for ~53 ms on ownership checks alone.

The file is now read once at boot and the in-memory map is authoritative; every mutation writes through
`writeJsonAtomic` (temp + rename) on a serialized promise chain. **1532× faster per check** (1.07 ms →
0.0007 ms), and two bugs fell out with it: the old plain `fs.writeFile` could truncate `sandboxes.json`
on a crash mid-write (losing every record, and with it the only index from containers to worktrees), and
two concurrent read-modify-write cycles could silently drop an update. `get()`/`list()` return shallow
copies, preserving the "a caller cannot mutate the store" property that fresh-parse-per-read gave for
free. A corrupt file is quarantined to `sandboxes.json.corrupt-<ts>`, never overwritten.

**This is why the repository interface exists.** The fix belongs behind `ISandboxRepository`, not in the
security layer — swap in Redis/Postgres for a second node and no guard changes. The single-node
assumption is the same one `FsEventHub`, `WorkspaceWatchers` and the on-disk worktrees already make.
Self-check: `backend/__tests__/json-sandbox-repository.test.ts` (no disk reads after boot, copy-on-read,
concurrent writes, corrupt-file quarantine).

`JsonSessionRepository` still reads per call. It is not on the auth path (one write per launch), so it is
left alone — fix it when it shows up in a profile, not before.

### `DELETE /api/v1/sessions/:sessionId` is unauthenticated — ⛔ owed
It doesn't verify the session belongs to the caller. Impact dropped now that the sweeper ignores session
state (it can no longer be used to force-pause someone's workspace), but it still emits a disconnect event
for any guessed id. Owner-gate it. See `editor/SECURITY.md`.

### One sandbox per (user, environment) — deliberate ceiling
`SessionController` keys warm reuse on `getSandboxesByEnvId` + `userId`, so a user cannot run two
concurrent sandboxes from the same environment; the second launch returns the first. That is the
intended behaviour (it *is* the double-provision fix). If parallel sandboxes per env are ever wanted,
they need an explicit "new sandbox" action that calls `POST /v1/sandboxes` directly — not a change to
the launch path.

### State model — git IS our Merkle tree + WAL (read this before proposing one)
Each sandbox is a **git worktree** on host disk (`WorktreeEngine.ts`, branch `sbx-<id>`). That is not
incidental — it means the durable, content-addressed, diffable state store already exists:
* **Merkle tree** = git tree objects (content-addressed SHAs). Drift detection = `git status --porcelain`
  (already used by `isDirty()`). Root hash = `git rev-parse HEAD^{tree}`.
* **WAL / crash recovery** = the worktree files survive a gateway crash (restart → re-read disk); commits
  + reflog are the append-only recovery log; `git reset --hard <ref>` is exact hydration.
* **Live drift** = chokidar hands us the exact changed path (Step 10d) — no tree needs to be re-hashed
  to *rediscover* a change we were already told about.

So there is **no hand-rolled Merkle/WAL engine**, by design. The only state git doesn't hold is terminal
scrollback, which is a flat blob, not a tree — see Step 11 / `SessionStore`. The VFS is deliberately
plain: last-write-wins outbound, a dirty-preserving patch inbound, no client-side hashing or SHA-sync
protocol (it would only duplicate git with weaker guarantees).

### Egress + tenant isolation — ✅ SOLVED (was the "ISSUES" block)
Sandbox-to-sandbox injection and unrestricted egress are closed: every sandbox boots with a
deny-default `NetworkPolicySpec` (allow-list = package registries + GitHub + the env's
`allowedDomains`), enforced by a per-sandbox `dns+nft` egress sidecar. Cross-tenant raw-IP
reads verified BLOCKED live (kernel 6.18); on kernels without nf_tables the capability gate
degrades gracefully (boots un-isolated with a loud warning; `npm run doctor` reports which).
The doctor's global docker-DNS fix does NOT conflict — the sidecar intercepts port-53 via
nftables, so the global resolver only serves no-policy containers. Full details, operator
guide, and the daemon-features roadmap: [`sandbox/network/README.md`](./backend/src/services/sandbox/network/README.md).

### VFS Conflict Resolution — optimistic concurrency (owed, narrowed)
* **Status: ⚠️ Partly mitigated.** The **watcher-vs-dirty-edit race is gone**: the 10d `patch` path is
  dirty-preserving (`applyPatch` never overwrites/removes a dirty node). What remains is **two writers
  to the same file** (two tabs/editors) — `/write` is still last-write-wins with no base-version check.
* **What to build (only when multi-writer is real):** a base-SHA check on the write path — client sends
  the blob + the file's `git hash-object` it started from; backend `POST /api/fs/:id/git-sync` compares
  against the worktree and returns **409** on divergence; client pulls + merges. git (`WorktreeEngine`)
  is the merge substrate — we do **not** reinvent it client-side. YAGNI until concurrent editing ships.