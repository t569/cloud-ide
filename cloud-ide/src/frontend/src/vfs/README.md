# 🗄️ Virtual File System (VFS) & Sync Engine

The VFS is the high-performance data layer of the Cloud IDE. It acts as the "Single Source of Truth" for all file data in the browser, sitting between the React UI components, the Monaco Editor, and the Remote Backend Sandbox.

## 🏗️ Architecture Overview

The system is strictly decoupled into two distinct parts to separate data logic from UI rendering:

1. **`VirtualFileSystem.ts` (The Engine):** A pure data structure. It manages an $O(1)$ memory map, a debounced background sync queue (outbound), and `applyPatch` (inbound). It knows *nothing* about React or the Event Bus.

> **Where the "Merkle tree" lives:** in the backend **git worktree**, not here. Git's object store already gives us a content-addressed tree (hashing + cheap diff via `git status`) and a write-ahead log (commits + reflog), so the client deliberately does **no** hashing or SHA-sync protocol — it would just duplicate git with weaker guarantees. The VFS is plain state: last-write-wins outbound, a dirty-preserving patch inbound. See root `ARCHITECTURE.md` → "git IS our Merkle tree + WAL" for the full rationale.
2. **`VFSController.ts` (The Traffic Cop):** The bridge, located in [`../editor/core/VFSController.ts`](../editor/core/VFSController.ts) (not in this folder). It listens to the `EditorEventBus`, translates user actions into VFS commands, and dispatches state updates back to the React UI via Context/Reducers.

---

## ⚡ Core Features

### 1. $O(1)$ Memory Map (Flat Storage)
Unlike the UI, which needs a nested folder structure to render a File Explorer, the VFS stores all files in a flat `Map<string, VFSNode>`. 
* **Read/Write Latency:** Instant. `vfs.get('/src/components/App.tsx')` requires no tree traversal.
* **Tree Generation:** The VFS exposes `getNestedTree()`, an $O(N \log N)$ algorithm that instantly sorts and parses the flat map into a nested JSON array for React to render when needed.

### 2. Optimistic UI Updates
When a user types in the editor or creates a file, the VFS updates its local memory instantly and marks the file as `isDirty`. The UI updates immediately without waiting for network latency.

### 3. Debounced Background Sync (outbound)
To avoid hammering the backend while a user types, the VFS drains a debounced queue instead of writing per keystroke.
* **Add:** modified files are added to a `syncQueue` Set (and marked `isDirty`).
* **Flush:** every 2 seconds (or immediately on `Ctrl+S` via `forceSync()`) the queue drains to the per-file FS API — `POST /write`, `DELETE /delete`.
* **Semantics:** **last-write-wins.** Durability and history live in the backend git worktree, not the client. There is no base-SHA/optimistic-concurrency check yet (owed only once concurrent multi-writer editing ships — see root `ARCHITECTURE.md` → Known Debt).

### 4. Live Tree Patch (inbound, dirty-preserving)
When the backend chokidar watcher sees the workspace change on disk (npm install, git, an agent), it pushes the **exact changed paths** over SSE. `applyPatch(changes)` folds them into the map surgically:
* **add / addDir:** insert only if the path is absent — never overwrite a local optimistic node or a fetched blob.
* **unlink / unlinkDir:** remove the node/subtree, but **skip any `isDirty` node** — a disk delete never yanks unsaved work.

This is why the explorer stays live even with unsaved edits open. The coarse `hydrateWorkspace()` full-refresh remains as a fallback (and is still skipped while edits are pending, since it clears the map).

---

## 🚦 The Data Flow Lifecycle

1. **UI Event:** User types in Monaco.
2. **Event Bus:** Monaco emits `CONTENT_CHANGED`.
3. **Controller:** `VFSController` catches it, dispatches a `MARK_DIRTY` action to React to show the unsaved dot, and calls `vfs.updateFile()`.
4. **Engine:** VFS updates the memory map and queues the path.
5. **Daemon:** The 2-second interval triggers `flushSyncQueue()`.
6. **Network:** VFS pushes each queued write/delete to the per-file FS API and awaits `200 OK`.
7. **Resolution:** VFS clears the queue, un-dirties the written nodes, and tells the Controller to switch the UI traffic light to `synced`.

---

## 🔌 Event Bus API Contract

The `VFSController` (in [`../editor/core/`](../editor/core/VFSController.ts)) strictly listens to and emits the following events on the `EditorEventBus`:

### Listens To:
* `FILE_OPEN_REQUESTED` - Triggers file load from VFS.
* `CONTENT_CHANGED` - Queues an optimistic file update.
* `SAVE_REQUESTED` - Bypasses the debounce timer for an immediate sync force.
* `FILE_CREATED` / `FILE_DELETED` / `FILE_RENAMED` - Triggers CRUD operations.
* `TAB_ACTIVATED` / `TAB_CLOSED` - Updates workspace focus state.

### Emits:
* `FILE_LOADED` - Passes file content to Monaco.
* `VFS_TREE_UPDATED` - Hands a freshly generated nested JSON tree to the File Explorer.

---

## 🛠️ Modifying the Sync Backend
If you change your backend API structure, you only need to update the `flushSyncQueue` and `hydrateWorkspace` methods inside `VirtualFileSystem.ts`. The rest of the IDE will remain unaffected.