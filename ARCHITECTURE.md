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
* **Status: ✅ Complete**
* **Files:** `editor/`, `api/vfs.js`, `pages/IDEWorkspace.jsx`
  * [x] **6a.** File click fetches content via the VFS API (`vfs.js` aligned to the real `/api/fs` routes).
  * [x] **6b.** `Ctrl+S` save + 1s debounced auto-save routing to POST `/fs/:id/write`.

### Step 7: End-to-End Integration & Polish
* **Status: ❌ Not Started**
* **Goal:** Production readiness.
  * [ ] **7a.** Unify async boundary error handling.
  * [ ] **7b.** Add loading skeletons.
  * [ ] **7c.** Write deployment runbook.