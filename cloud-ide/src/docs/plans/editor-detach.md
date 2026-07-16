# Editor Detach — plan

Status: **implemented** (2026-07-16). Related: [network-egress-layer.md](./network-egress-layer.md).

## Goal

A **Detach** action in the editor that pauses the sandbox (releases compute — Scale-to-Zero)
and returns the user home. Reopening later resumes onto the *same* container + worktree, with
files and running processes intact.

## Why

Leaving the editor today (navigate away / close tab) does **not** pause the sandbox — it keeps
running until `IdleSweeper` reaps it on its own schedule. Detach is the explicit, intentional
"I'm done for now" gesture: immediate resource release, non-destructive, reversible. It is NOT
delete (the record and worktree stay) and NOT stop (the container stays paused, not removed).

## Behaviour

1. User clicks **Detach**.
2. **Flush unsaved edits** — `vfs.forceSync()` (or emit `SAVE_REQUESTED: 'ALL'`) so the 2 s
   autosave debounce can't drop the last keystrokes when the component unmounts.
3. `POST /v1/sandboxes/:id/pause`.
4. Navigate **home**.
5. Toast: `Detached — <workspaceName> paused`.

Reopen (already works): from the Sandboxes list / home, `openWorkspace(sandboxId)` →
`ensureRunning` resumes the PAUSED container.

## Backend — no change needed

- `POST /v1/sandboxes/:sandboxId/pause` → `SandboxController.pauseSandbox` → `SandboxManager.pause`
  already exist (`SandboxRoutes.ts:50`).
- `pause()` returns `false` / the route 409s if the sandbox isn't running. The UI treats that as
  "already detached": swallow it and still navigate home.

## Frontend

1. **`api/sandbox.ts`** — add:
   ```ts
   export const pauseSandbox = (sandboxId: string) =>
     apiClient.post<{ paused: boolean }>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}/pause`, {});
   ```
2. **Detach action** wired into the editor. Handler (in `EditorWorkspace`, or routed via the
   event bus like the other top-bar actions):
   ```ts
   const detach = async () => {
     eventBus.emit('SAVE_REQUESTED', { path: 'ALL' });   // flush dirty buffers first
     try { await pauseSandbox(sandboxId); }
     catch (e) { /* 409 not-running -> already paused/stopped, fine */ }
     navigateHome();                                      // router → '/'
     toast.success(`Detached — ${workspaceName} paused`);
   };
   ```
3. **Placement** (decision needed — see Open questions): a top-bar button is the most
   discoverable; a `TopNavBar` menu item (File → Detach) is the lowest-friction to add.
4. **Cleanup**: unmount already tears down the SSE FS stream (`VFSController.destroy`) and the
   terminal, so no extra teardown is required.

## Correctness / edge cases

- **Unsaved edits** — must flush before pause. This is the one real footgun; everything else is
  covered by existing teardown.
- **Egress netns** — `pause` keeps the container **PAUSED**, not stopped, so the sandbox+sidecar
  netns pair survives and stays resumable. (A *stopped* pair is unresumable — pause never stops,
  so detach is safe for egress sandboxes. See egress plan.)
- **Dev servers / terminals** — shells outlive their socket, and pause *freezes* the container's
  processes (they thaw on resume). A running dev server survives detach → reopen with no special
  handling.
- **Same sandbox open in two tabs** — detaching one pauses it under the other; the other tab's
  next action triggers `ensureRunning` and resumes. Rare; do not handle in v1.

## Out of scope (v1)

- Auto-detach on tab close (that is `IdleSweeper`'s job).
- A "detach without pause" variant.
- Reflecting the paused state live in the *other* open tab.

## Testing

- Unit: `pauseSandbox` request shape.
- Manual: open a sandbox → edit a file → **Detach** → verify (a) Sandboxes list shows PAUSED,
  (b) the edit was saved, (c) home is shown → reopen → resumes with edits **and** a still-running
  dev server.

## Open questions — resolved

1. **Placement** — **both**: a top-bar button (right side, next to the workspace name —
   the discoverable primary) and `File → Detach` (one line in `coreContributions`). Both
   emit one `DETACH_REQUESTED` bus event; `EditorWorkspace` owns the single handler.
2. **Confirm dialog?** **No** — non-destructive and reversible.
3. **Label** — **"Detach"**; the button tooltip spells out "save, pause, return home".

## Implementation notes (what shipped differs from the sketch)

- `eventBus.emit('SAVE_REQUESTED')` is fire-and-forget (`setTimeout 0`), so the handler
  can't know when the flush lands. Instead `VFSController.flush()` (awaitable
  `vfs.forceSync()`) is exposed through `useWorkspaceBootstrap`; detach **awaits** it and
  **cancels** (with a toast) if it fails — never navigate away over an unflushed queue.
- Residual bug fixed while here: `VirtualFileSystem.destroy()` dropped the pending sync
  queue, so ANY exit (navigate away, close tab) lost the last ≤2 s of typing. It now
  fires `flushSyncQueue()` on destroy (in-flight fetches complete after unmount).
  Covered by `VirtualFileSystem.destroy.test.ts`.
