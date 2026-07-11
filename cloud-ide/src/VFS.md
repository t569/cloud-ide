# 📁 Virtual File System (VFS) — Design & Status

## The core insight

Every sandbox's `/workspace` is a **Git worktree bind-mounted from the host SSD**
(`data/worktrees/{worktreeId}`). The container and the gateway see the *same bytes*.
So the VFS does not need to talk to the container at all — it operates on the
host filesystem directly with `node:fs`.

```
Frontend ── HTTP ──> Gateway (FileSystemRoutes)
                        │
                        ▼
                 FileSystemManager ── node:fs ──> data/worktrees/{worktreeId}
                        │                                   ▲
                        ▼                                   │ (same bytes,
                 SandboxManager.getWorkspaceHostPath()      │  bind mount)
                        │                                   │
                        ▼                                   │
                 WorktreeEngine.getWorktreePath()    container /workspace
```

## Why host-direct (vs. the old exec-based approach)

The previous `FileSystemManager` shelled into the container per operation
(`ls`/`base64` via Rust → execd → `/bin/sh -c`). It was deleted because:

| | exec-based (old) | host-direct (current) |
|---|---|---|
| Round trips per op | 4 network hops + SSE parse | 0 — local disk |
| PAUSED sandboxes | must wake the container | works while frozen (Scale-to-Zero intact) |
| Security | shell injection via path interpolation | no shell; one path-traversal guard |
| File size limit | ~ARG_MAX (base64 on a command line) | none |

## Module boundaries (who knows what)

- **`FileSystemRoutes`** — pure transport. Validates params, speaks HTTP. Receives a
  `FileSystemManager`; knows nothing about storage.
- **`FileSystemManager`** — file operations + the trust boundary. Every public method
  resolves container paths (`/workspace/...`) through a traversal guard. Only knows
  `SandboxManager.getWorkspaceHostPath()`.
- **`SandboxManager`** — owns the sandbox↔worktree mapping. Doesn't do file I/O.
- **`WorktreeEngine`** — single source of truth for the worktree layout on disk
  (injected into `SandboxManager`, swappable in tests).
- **Frontend `api/vfs.js`** — mirrors the four routes; the editor and sidebar only
  see container-visible paths, never host layout.

## ✅ Implemented

- [x] `GET /api/fs/:sandboxId/ls?path=...` — flat directory listing (sidebar lazy-loads per level)
- [x] `GET /api/fs/:sandboxId/read?path=...` — UTF-8 file content
- [x] `POST /api/fs/:sandboxId/write` — save with auto-`mkdir -p`
- [x] `DELETE /api/fs/:sandboxId/delete?path=...` — recursive, refuses the workspace root
- [x] Path-traversal guard (`..`/absolute escapes rejected) — covered by tests
- [x] Editor integration: file click → read, Ctrl+S + 1s debounced autosave → write
- [x] Jest suite against a real temp directory (`filesystem-manager.test.ts`)

## 🔜 Deferred (deliberate, with upgrade paths)

- [ ] **File-change events.** `chokidar` is already installed and `WorkspaceManager`
  is the empty stub reserved for this. Plan: watch worktree roots, push
  create/change/delete events to the frontend (SSE or the existing `ws` dep) so the
  sidebar refreshes when the terminal touches files. Add when the sidebar lands.
- [ ] **Recursive `/tree` endpoint.** Only if per-level lazy-loading measurably hurts
  the sidebar UX; a flat `ls` per expanded folder is usually enough.
- [ ] **Multi-node provider seam.** Current design assumes the gateway and worktrees
  share a disk (single node). If they ever split, reintroduce an
  `IFileSystemProvider` interface and add an agent-backed implementation behind it —
  the route layer already only sees the manager's four methods, so the seam is cheap.
- [ ] **Binary file support.** Read/write are UTF-8 today; the editor only handles
  text. Add base64 or streaming endpoints when images/assets need editing.
- [ ] **Rename/move endpoint.** The old frontend client had `renameEntity` with no
  backend; add `fs.rename` + route when the sidebar grows a rename action.
