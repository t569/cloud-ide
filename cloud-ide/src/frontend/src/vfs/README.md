# 🗄️ Virtual File System (VFS) & Sync Engine

The VFS is the high-performance data layer of the Cloud IDE. It acts as the "Single Source of Truth" for all file data in the browser, sitting between the React UI components, the Monaco Editor, and the Remote Backend Sandbox.

## 🏗️ Architecture Overview

The system is strictly decoupled into two distinct parts to separate data logic from UI rendering:

1. **`VirtualFileSystem.ts` (The Engine):** A pure data structure. It manages an $O(1)$ memory map, handles cryptographic Merkle hashing, and manages the background sync queue. It knows *nothing* about React or the Event Bus.
2. **`VFSController.ts` (The Traffic Cop):** The bridge. It listens to the `EditorEventBus`, translates user actions into VFS commands, and dispatches state updates back to the React UI via Context/Reducers.

---

## ⚡ Core Features

### 1. $O(1)$ Memory Map (Flat Storage)
Unlike the UI, which needs a nested folder structure to render a File Explorer, the VFS stores all files in a flat `Map<string, VFSNode>`. 
* **Read/Write Latency:** Instant. `vfs.get('/src/components/App.tsx')` requires no tree traversal.
* **Tree Generation:** The VFS exposes `getNestedTree()`, an $O(N \log N)$ algorithm that instantly sorts and parses the flat map into a nested JSON array for React to render when needed.

### 2. Optimistic UI Updates
When a user types in the editor or creates a file, the VFS updates its local memory instantly and marks the file as `isDirty`. The UI updates immediately without waiting for network latency.

### 3. Git-Style Background Sync (Lazy Merkle)
To prevent DDoS-ing the backend while a user is typing, the VFS uses a Debounced Sync Queue with cryptographic verification.
* **Add:** Modified files are added to a `syncQueue` Set.
* **Hash:** Every 2 seconds, the daemon wakes up, calculates SHA-256 hashes *only* for the dirty files using the native Web Crypto API, and generates a new Root SHA for the workspace.
* **Push:** The VFS sends a delta payload containing only the modified blobs and the new Root SHA to the backend.
* **Verify:** The backend compares the SHAs against its internal Git worktree, guaranteeing mathematically verifiable perfect synchronization.

---

## 🚦 The Data Flow Lifecycle

1. **UI Event:** User types in Monaco.
2. **Event Bus:** Monaco emits `CONTENT_CHANGED`.
3. **Controller:** `VFSController` catches it, dispatches a `MARK_DIRTY` action to React to show the unsaved dot, and calls `vfs.updateFile()`.
4. **Engine:** VFS updates the memory map and queues the path.
5. **Daemon:** The 2-second interval triggers `flushSyncQueue()`.
6. **Network:** VFS hashes the changes, pushes the JSON payload to the backend, and awaits a `200 OK`.
7. **Resolution:** VFS clears the queue, updates the version numbers, and tells the Controller to switch the UI traffic light to `synced`.

---

## 🔌 Event Bus API Contract

The `VFSController` strictly listens to and emits the following events on the `EditorEventBus`:

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