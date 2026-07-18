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

## Decision 5 — Concurrency: fork-per-sandbox, reconcile at save (worktrees ARE the mitigation)

The risk: two sandboxes inject the same workspace W at once. It splits into two separate problems.

**Runtime isolation** — never share a writable layer. Each sandbox gets its own writable surface
(overlayfs `upperdir`, or its own worktree). No two containers write the same bytes; no corruption.
This falls out of Decision 2 for free.

**Save reconciliation** — two divergent states both want to become durable W. That is a *merge*, and
git is the right tool. Surface divergence the way the existing live-tree sync does — **409 + explicit
reconcile**, never a silent clobber (ARCHITECTURE.md → "git IS our Merkle tree + WAL").

**Worktrees mitigate this — with one caveat.** Git REFUSES two worktrees on the *same* branch. So we
never check out W's ref directly; each sandbox gets a worktree on a **branch forked from W**:
`git worktree add -b sbx-<id> <path> refs/workspaces/<W>`. N sandboxes = N worktrees = N branches, all
sharing the object store (near-zero marginal cost — the whole reason we picked git). This is what
`WorktreeEngine.createWorktree` already does; the workspace ref simply becomes the fork point instead
of an empty branch.

- **overlayfs materialiser:** the shared `lowerdir` is a *static, read-only* materialisation of W, so
  git's same-branch restriction never even applies — N sandboxes share one lower, each its own upper.
  Cleanest concurrency story; the git fork only appears at save time.
- **git-checkout materialiser (fallback):** the per-sandbox forked worktree above, live.

**Save (both paths):** the sandbox's state (upper delta, or forked branch tip) becomes a commit;
persisting to W is a **fast-forward when W hasn't moved**, and a **merge / "save as a branch of W"**
when it has (concurrent divergent saves). Concurrent workspace edits are just branches — merging them
is git's day job.

→ v1 default: **fork-per-sandbox, fast-forward save, explicit merge on divergence.** A stricter
**exclusive attach** (one live persistent sandbox per workspace) is a per-workspace option for users
who want zero merge surprises. Directly answers "two worktrees on one workspace": don't — fork one
worktree per sandbox off the workspace ref, and let save-time merge reconcile.

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
3. **overlayfs materialiser** (GATED on Spike 3a below). lower/upper split + save-from-upper + boot
   allow-list + teardown cleanup + capability detection + graceful fallback.
4. **Save/persistence.** WIP-snapshot (uncommitted capture), auto-save-on-detach, persistence modes,
   "Save as workspace" / "Discard".
5. **Sources.** Wire `git-url` (cloneInto) and revive `LocalMountStrategy` (`host-folder`) as workspace
   sources; `blank` default.
6. **Frontend.** Workspace picker/manager (like the env manager) + inject/detach/save UI, with the
   frontend-design plugin.

## Spike 3a — overlayfs-under-Docker (RUN ON THE LINUX/WSL HOST)

Cannot run from the Windows canonical clone (no Linux kernel / Docker there). Execute on the WSL
run-host. This gates Phase 3.

```sh
# Durable base, materialised ONCE per workspace — read-only lower.
L=$CIDE_DATA_DIR/workspaces/<wid>/base
# Per-sandbox ephemeral layers. upper+work MUST share a filesystem (ext4 is fine).
U=$CIDE_DATA_DIR/sbx/<sid>/upper; Wk=$CIDE_DATA_DIR/sbx/<sid>/work; M=$CIDE_DATA_DIR/sbx/<sid>/merged
mkdir -p "$U" "$Wk" "$M"
sudo mount -t overlay overlay -o lowerdir="$L",upperdir="$U",workdir="$Wk" "$M"
# Then bind-mount $M into the container at /workspace (the WorktreeStrategy mount path).
# Teardown: sudo umount "$M";  ephemeral -> rm -rf "$U";  save -> commit "$U" delta into refs/workspaces/<wid>.
```

**Spike run 2026-07-18 (WSL kernel 6.18.33.2, /tmp ext-family) — CORE MECHANICS PASS.**
A pure-overlay test (no Docker) validated: overlayfs supported; two sandboxes mounted on ONE
read-only lower; **isolation** (A's write invisible to B, lower untouched); **thin upper**
(upper held only the changed files, base not copied — CoW confirmed); **round-trip** (a saved
upper delta re-materialised into a fresh overlay); **clean teardown** (0 leaked mounts). The
FS is ext-family (no reflink) → overlay is the correct CoW choice, as designed. STILL TO
CONFIRM before Phase 3 ships: (a) Docker bind-mount of the overlay *merged* dir into the
container, and (b) non-root container-uid writes to the upper layer (privileges Phase 2.1).

Acceptance criteria (remaining, gate Phase 3):
1. **Memory win** — two sandboxes share one `$L`; the base is resident ONCE in the page cache
   (`/proc/meminfo` before/after, or compare container RSS).
2. **Isolation** — writes in A's `$U` are invisible in B's merged view.
3. **Speed win** — inject latency ~constant regardless of base size (contrast: git checkout scales).
4. **No leaks** — N create/destroy cycles leave zero overlay mounts (`mount | grep overlay` empty) and
   zero orphan workdirs.
5. **Round-trip** — a saved `$U` delta re-materialises correctly into a fresh overlay.
6. **Non-root writes** — the non-root container user can write `$U` (same a+rwX / 0777 stance as the
   worktree and cache mounts; privileges Phase 2.1 territory).

Risks to confirm during the spike:
- Docker bind of an overlay *merged* dir (binding a mountpoint — should work; verify mount propagation).
- WSL2 kernel overlay support (present) alongside Docker's own overlay storage driver — ours is a bind,
  not the container rootfs, so the historical nested-overlay restriction shouldn't apply. Confirm.
- Boot allow-list (`opensandbox/boot.js`) must accept `$M`.

**If 3a fails:** ship Phases 1–2 + 4–6 on the git-blobless-checkout materialiser (fork-per-sandbox
worktrees, Decision 5), and keep overlay as a later optimisation. The design degrades cleanly because
the materialiser is a seam.

## Open questions (before build)

- WIP-snapshot vs. leaving uncommitted state in the upper layer only (do we *need* a git shadow ref if
  the upper layer already persists when saved?) — the ref buys portability + history; the upper alone
  buys speed. Likely: upper for live, WIP-commit only on "save to durable ref".
- Multi-node: refs + objects replicate via git; overlay upper layers are node-local (a detached,
  saved workspace is portable; a live ephemeral one is not). Acceptable — matches the egress/idle model.
- Concurrency is answered by Decision 5 (fork-per-sandbox + merge-at-save); the remaining call is
  whether v1 ships the exclusive-attach option or defers it.
