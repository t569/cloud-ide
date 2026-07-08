# ☁️ Cloud IDE Architecture & Implementation Plan (v2.0)

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
* **Routes:** `/environments` (default) · `/editor/:sandboxId` (booted editor). `/sandboxes`
  (Step 12) and `/setup` are reserved for their steps.
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
* **Files:** `api/sandbox.ts` (`POST /api/v1/sandboxes` → `SandboxRecord`), `pages/sessionStore.ts`
  (warm-boot session bridge), `pages/Environments.tsx` (provision + `navigate`),
  `env-manager/components/{EnvManager,MyEnvironments}.tsx` (router-agnostic `onLaunch`),
  `pages/AppShell.tsx` (`getSession`).
  * [x] **9a.** `createSandbox({ imageTag: env.imageName, envVars })` → `SandboxManager.provision`
    returns the `sandboxId`. Launch is disabled until the env has a built image.
  * [x] **9b.** `Environments.handleLaunch` stashes the session and `navigate('/editor/:sandboxId')`.
    EnvManager exposes `onLaunch?` only — it stays decoupled from routing + provisioning.
  * [x] **9c.** Session carries `envConfig` + `workspaceName`; the editor surfaces the env name in
    the top bar (`SET_WORKSPACE_NAME`). **Env vars** are applied at container boot via
    `SandboxSpec.envVars` (passed in 9a) — the correct layer; the terminal/exec inherits them, so no
    per-exec injection. (Showing `baseImage` in the status bar is cosmetic and rides with the wider
    StatusBar wiring, still mock.)
  * [x] **9d.** Provisioning gate: `waitForRunning` (`api/sandbox.ts`) polls `GET /api/v1/sandboxes/:id`
    until `RUNNING` before entering the editor; a sticky toast covers the wait, errors/timeouts abort
    with a toast. See `editor/README.md` → Design Notes.

### Step 10: Backend FS Watcher → Live Tree (chokidar)  — paired with `editor/README.md` Phase 5
* **Status: ✅ Complete** (10a–c done; 10d optional). Follow-up: the Tier-1 dirty-preserving refresh
  (removes the guard's coarseness) — see "Known Debt".
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
    opens an `EventSource` (`withCredentials`) and re-hydrates on `reload_tree`, emitting
    `VFS_TREE_UPDATED`. **Guard:** skips re-hydrate while `vfs.hasPendingSync()` — a full re-hydrate
    would clobber unsaved edits (the merge case is the "Known Debt" merkle protocol). No new dep, no
    WS upgrade. Files: `backend/services/FsEventHub.ts`, `backend/api/FileSystemRoutes.ts`, `server.ts`,
    `frontend/editor/core/VFSController.ts`, `frontend/vfs/VirtualFileSystem.ts`.
  * [x] **10c. chokidar watcher.** `WorkspaceWatchers` (`backend/services/`): **demand-driven** —
    ref-counted per SSE subscriber (acquire on connect, release on last disconnect), so we never
    watch an unviewed workspace and resumed/persisted sandboxes work without provision hooks. Watches
    the host worktree, debounced (300ms), ignores `node_modules`/`.git`, only tree-shape events
    (`add`/`unlink`/`addDir`/`unlinkDir` — not `change`, avoiding self-write echo) → `hub.publish`.
    Full chain: chokidar → `FsEventHub` → SSE → `EventSource` → `VFSController` re-hydrate →
    `VFS_TREE_UPDATED`.
  * [ ] **10d.** Diff-based patch (only changed subtrees) if full re-hydrate is too heavy at scale.

### Step 11: Snapshots (File Tree + Terminal/Sandbox Context)
* **Status: ❌ Not Started**  (frontend contract stubbed: `WorkspaceSnapshot`, `SNAPSHOT_*` events,
  `ISerializable<T>` in `editor/types/editor.d.ts`)
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
* **Status: ❌ Not Started**
* **Goal:** a `/sandboxes` page listing the user's live + PAUSED sandboxes; clicking one navigates to
  `/editor/:sandboxId`, resuming it. Reuses the **Wake-on-Demand** resume already built for the proxy
  (Step 3c) — a paused sandbox is resumed on first traffic.
* **Files:** new `pages/Sandboxes.tsx`; backend list endpoint over `SandboxManager` records; env-manager
  links here.
  * [ ] **12a.** `GET /api/sandboxes` (id, name, status, lastActive) from the `SandboxManager` DB.
  * [ ] **12b.** `pages/Sandboxes.tsx` grid (status pills: live / paused / stopped) → `navigate('/editor/:id')`.
  * [ ] **12c.** Resume on open (reuse Wake-on-Demand); show a "resuming…" state until ready.
  * [ ] **12d.** Link env-manager ↔ sandboxes ↔ editor in the top-level nav.

**Suggested order:** 8 (routing) → 9 (env→editor) → 10 (FS events) → 12 (resume page) → 11 (snapshots,
largest). Routing unblocks 9/12; snapshots lean on the worktree engine and are the heaviest lift.

---

## ⚠️ Known Debt

### VFS Conflict Resolution — Merkle sync protocol (owed)
* **Status: ❌ Not built** — the VFS write path (Step 10a) is **last-write-wins**.
* **Why it matters:** the backend FS API (`/write`, `/delete`) blindly overwrites. Two editors
  (or two tabs) editing the same file, or — critically — the **chokidar watcher (Step 10c)** firing
  a re-hydrate that races a local dirty edit, can **silently clobber** changes. There is no base-version
  check, so nobody is told a conflict happened.
* **What to build:** reinstate the git-style sync the VFS originally stubbed (the `GitSyncPayload`,
  `calculateRootSha`, and `expectedBaseSha`/`newRootSha` scaffolding removed in Step 10a). The client
  sends changed blobs + the workspace root SHA it started from; a new backend `POST /api/fs/:id/git-sync`
  verifies that base SHA against the worktree's current state and returns **409** on divergence. The
  client then pulls + merges (three-way or last-modified-wins with a prompt) instead of overwriting.
* **Where it plugs in:** `frontend/src/vfs/VirtualFileSystem.ts` (`flushSyncQueue` → send SHAs, handle
  409) + a backend endpoint over the existing `WorktreeEngine` (which already gives us git as the
  merge substrate). **Pairs with Step 10c** — the watcher is exactly what turns "theoretical race" into
  "real race," so build this alongside (or immediately after) the live-tree work.