# Workspace as a First-Class Entity — plan (research + design)

Status: **design/discussion** (opened 2026-07-18). Not yet approved. Branch: TBD (after `feat/git`).
Related: [git-integration.md](./git-integration.md), [package-cache.md](./package-cache.md),
[sandbox-privileges.md](./sandbox-privileges.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) → "git IS our Merkle tree + WAL".

## The ask

A **workspace** becomes a first-class entity, like an environment: **injectable into / detachable
from** any sandbox, decoupled from the container's lifecycle. A sandbox has a *default* workspace
config. What **survives** a container's death: the **caches** and the **workspace/repo**. Ephemeral
file churn that isn't saved dies with the container. **Opt-in persistence** — save a workspace, or
let it die. Must be **fast to inject** and **memory-optimised**.

## What already exists (80% of the model)

- **Caches already outlive the container.** `cacheVolumes.ts` mounts a per-*owner* `/cide-cache`
  that survives container swaps *and* worktree deletion. The "caches survive" requirement is done.
- **Committed workspace state already outlives the container.** `WorktreeEngine`'s whole invariant
  is "the checkout is disposable, the branch `sbx-<id>` is not." Durable git ref = durable workspace.
- **Volumes already attach declaratively.** `SandboxRecord.desiredVolumes` + `normalizeUserVolumes`
  + the boot allow-list; a sandbox re-provisions onto its existing `worktreeId` (recover()).

**The gap:** the worktree is welded 1:1 to a sandbox (`worktreeId = randomUUID()` per sandbox, no
name, no reuse across sandboxes), and *uncommitted* files are the "ephemeral churn" that dies. So
this feature is: **lift the workspace out of the sandbox into a named, reusable entity, and give it
an explicit save boundary** — not a new storage engine.

---

## Decision 1 — Durable form: a **git ref** (compose over worktrees)

A workspace's durable form is a **named git branch/ref** in the existing central bare repo. Chosen
over a CoW-FS snapshot or a bare named volume because:

- The repo philosophy is explicit: *git IS our content-addressed store + WAL; don't hand-roll one.*
  A git ref dedupes across workspaces via the shared object store (two workspaces off the same repo
  share objects for free), carries history, and the machinery already exists.
- A bare "named volume" has no dedup and no history — it re-solves what git solves.
- A separate snapshot filesystem (btrfs/ZFS snapshots) duplicates git's job and pins us to a FS.

**The one thing a ref doesn't capture: uncommitted files.** Solved the way jujutsu / GitButler /
VS Code Timeline do — an **auto-WIP snapshot**: on save/detach, capture the working tree to a shadow
commit (`git stash create` or `git commit-tree` against a `refs/wip/<workspace>` ref) so "save" never
forces the user to craft a commit, and nothing uncommitted is lost. Restoring re-applies the WIP on
top of the real branch.

→ **Workspace durable form = a git ref (`refs/workspaces/<id>`), with a WIP shadow ref for
uncommitted state. Composes over `WorktreeEngine`; no new content store.**

## Decision 2 — Inject mechanism: **overlayfs CoW** (git checkout as portable fallback)

"Fast to inject + memory-optimised" = materialise the workspace into `/workspace` with near-zero
copy and shared memory. Ranked:

1. **overlayfs (recommended primary).** `lowerdir` = the workspace's canonical materialised checkout
   (read-only, **shared across every sandbox of that workspace → shared page cache = the memory win**);
   `upperdir` = a per-sandbox writable layer (the **ephemeral churn**); the container mounts the merged
   view. Inject = an overlay mount (**instant, copies nothing**). This *also* gives the save boundary
   for free: the `upperdir` IS the ephemeral, per-container delta — "save" promotes it into the ref,
   "die with container" throws it away. Works on **ext4** (our WSL host FS), unlike reflink.
2. **Reflink / CoW copy** (`cp --reflink=auto`) where the FS is **btrfs or XFS** — instant CoW clone,
   pages shared until written. Simpler semantics than overlay, but ext4 (our default) has **no reflink**,
   so this is an opportunistic fast-path, not the baseline.
3. **git blobless checkout** (`--filter=blob:none`, already built in `cloneInto`) — the **portable
   fallback**: dedup via the object store, lazy blob materialisation, works anywhere git does. Cost
   scales with working-tree size, but never copies unopened blobs.

→ **Primary: overlayfs (lower = shared durable, upper = ephemeral per-sandbox). Fallback: git
blobless checkout. Reflink where the host FS supports it.** Capability-detected at boot, like
`egressEnforceable()` degrades gracefully.

Open engineering question flagged for the build: overlayfs composed *under* a Docker bind mount
(mount the overlay on the host, bind-mount the merged dir in) — feasible, needs a mount helper and
cleanup on teardown; the boot allow-list (`opensandbox/boot.js`) must accept the merged path.

## Decision 3 — Persistence UX: **default + override + explicit save** (chosen for UX)

Losing work silently is the worst outcome; a forced commit on every throwaway is the second worst.
So, three states, with a smart default:

- **`persistent`** (default when launched *from a saved workspace*): auto-WIP-saved on detach/idle
  and on explicit Save; survives container death. The safe default — you can't lose a named workspace.
- **`ephemeral`** (default for a *blank/scratch* sandbox): the `upperdir` dies with the container.
  A one-click **"Save as workspace"** promotes it to `persistent` at any time (nothing is lost until
  you decline the prompt on teardown).
- **Explicit `Save now` / `Discard`** available in both modes.

The persistence mode lives on the workspace config (default) and is overridable per-sandbox at create
and via the save/discard actions later. Rule of least surprise: **named workspace ⇒ persistent;
scratch ⇒ ephemeral-but-promotable**. Auto-save-on-detach protects `persistent` from crashes.

## Decision 4 — Seam: **compose over the worktree layer, don't absorb it**

Per the CLAUDE.md mandate ("a feature is a new adapter, not a core edit"), the workspace entity
**wraps** `WorktreeEngine`; it does not replace it.

- New entity `WorkspaceRecord` (like `EnvironmentRecord`) in a `JsonWorkspaceRepository`:
  `{ id, name, ownerId, ref, source, persistence, cacheKey, createdAt, lastAttachedSandbox }`.
- `source ∈ { blank | git-url | host-folder }` — the git feature's `cloneInto` is the `git-url`
  source; `LocalMountStrategy` (to be revived) is `host-folder`; `blank` is an empty ref. **Git is
  one workspace source, not the workspace abstraction itself.**
- `SandboxRecord` gains `workspaceId` (the anonymous per-sandbox `worktreeId` becomes the degenerate
  case: an unnamed, ephemeral workspace). `getWorkspaceHostPath` resolves via the workspace.
- A `WorkspaceManager` orchestrates: `materialise(workspaceId, sandboxId)` (inject), `save(sandboxId)`
  (WIP-commit upper → ref), `detach(sandboxId, { save })`, `create(source)`, `delete(workspaceId)`.
  `WorktreeEngine` stays the git mechanism underneath; overlay/reflink is a materialisation strategy
  behind a `IMaterialiser` seam (mirrors the provisioning-strategy pattern).

This keeps the entire `feat/git` surface intact and unmoved.

## Proposed architecture

```
WorkspaceRecord (durable: ref + policy + source)         JsonWorkspaceRepository
        │  materialise()                    save()/detach()
        ▼                                        ▲
  WorkspaceManager ──uses──► WorktreeEngine (git ref ⇄ files)
        │
        ▼  IMaterialiser (capability-detected)
   overlayfs (lower=shared durable, upper=ephemeral)   ← primary, ext4-ok, memory-shared
   reflink CoW (btrfs/XFS)                              ← opportunistic
   git blobless checkout                                ← portable fallback
        │
        ▼  mounted at /workspace  (boot allow-list accepts the merged path)
   sandbox container  ── caches at /cide-cache (already per-owner, already survives)
```

Lifecycle: **create** workspace (from blank/git-url/host-folder) → **inject** (materialise, instant)
→ user edits (writes land in the ephemeral upper layer) → **save** (WIP-commit upper → ref, auto on
detach for `persistent`) → container dies (upper discarded; ref + caches survive) → **re-inject** into
a fresh sandbox, state restored.

## Memory optimisation, concretely

- **Shared `lowerdir` page cache** — N sandboxes of one workspace share the read-only base in RAM.
- **git object dedup** — workspaces off the same repo share blobs/trees on disk.
- **blobless / lazy materialisation** — unopened files never hit disk or RAM.
- **per-owner cache volume** — already deduped across a user's sandboxes.
- Upper layers are thin (only changed files), so ephemeral churn costs only its delta.

## Phases (to slot into planexecution)

1. **Entity + repo.** `WorkspaceRecord`, `JsonWorkspaceRepository`, `WorkspaceManager` skeleton;
   `SandboxRecord.workspaceId`; degenerate "unnamed ephemeral workspace" = today's behaviour (no
   user-visible change yet — pure refactor behind the seam).
2. **Materialiser seam.** `IMaterialiser` with the git-blobless-checkout implementation first
   (portable, no FS risk) — reproduces current mounting, proves the seam.
3. **overlayfs materialiser.** lower/upper split + save-from-upper + boot allow-list + teardown
   cleanup + capability detection + graceful fallback.
4. **Save/persistence.** WIP-snapshot (uncommitted capture), auto-save-on-detach, persistence modes,
   "Save as workspace" / "Discard".
5. **Sources.** Wire `git-url` (cloneInto) and revive `LocalMountStrategy` (`host-folder`) as workspace
   sources; `blank` default.
6. **Frontend.** Workspace picker/manager (like the env manager) + inject/detach/save UI, with the
   frontend-design plugin.

## Open questions (before build)

- overlayfs-under-Docker mount mechanics + teardown races on our WSL/ext4 host — spike in Phase 3.
- WIP-snapshot vs. leaving uncommitted state in the upper layer only (do we *need* a git shadow ref if
  the upper layer already persists when saved?) — the ref buys portability + history; the upper alone
  buys speed. Likely: upper for live, WIP-commit only on "save to durable ref".
- Multi-node: refs + objects replicate via git; overlay upper layers are node-local (a detached,
  saved workspace is portable; a live ephemeral one is not). Acceptable — matches the egress/idle model.
