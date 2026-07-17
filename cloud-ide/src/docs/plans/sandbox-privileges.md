# Sandbox Privileges — plan (non-root runtime)

Status: **proposed.** Branch: `feat/privileges` (branched off `feat/display`).
Related: [display-streaming.md](./display-streaming.md) (F3 audio), [network-egress-layer.md](./network-egress-layer.md),
[../../frontend/src/editor/SECURITY.md](../../frontend/src/editor/SECURITY.md).

## Why this exists — one change, a plethora of issues

Every sandbox today runs **untrusted user code as root inside the container.** That single
fact is behind a cluster of problems that this workstream closes together:

1. **Security.** Root-in-container is a materially larger escape surface for hostile code
   than an unprivileged user — and this platform's entire job is running untrusted code.
   The egress layer already drops `NET_ADMIN`; the process privilege is the matching gap.
2. **Audio is broken (display F3).** `pulseaudio` refuses to run as root ("Daemon startup
   failed"), so the Stage-2 audio tap never comes up. Proven live in the display E2E gate.
3. **Dead, half-built drop-root machinery.** The code to run non-root *exists* but never
   fires, and fails the build when forced on (details below). It's latent debt that reads
   as a working feature.
4. **Two conflicting defaults.** `StageOrchestrator` resolves `bootUpAsRoot ?? true`
   (`StageOrchestrator.ts:62,88`) while `naming.ts:106` resolves `?? false`. The build path
   wins, so the security-intent default (`false`) is silently overridden.

Fixing the privilege model fixes all four. That's why it's worth a dedicated branch.

## What the E2E gate proved is broken (evidence, not theory)

- `bootUpAsRoot ?? true` ⇒ `SecurityUserInjector` bails and the assembler never emits its
  `USER sandbox-user` line (`DockerfileAssembler.ts:65-67`), so the image ships with
  `USER=[]` (root). Confirmed by generating the Dockerfile and `docker inspect`.
- **Forcing non-root fails the build:** `SecurityUserInjector` runs
  `chown -R sandbox-user /workspace`, but `/workspace` **does not exist at build time** — it
  is the runtime worktree bind-mount. Build dies: `chown: cannot access '/workspace'`.
- **Even past that, the workspace is read-only for non-root:** worktree host dirs are
  `drwxr-xr-x root root` (`data/worktrees/<id>`, 0755). A non-root container can read but not
  write its own workspace. The cache mount already solved the analogous problem with 0777
  (`cacheVolumes.ts`); worktrees never did.
- **execd-as-non-root is unvalidated.** The daemon injects `execd`/`bootstrap.sh` and rewrites
  the entrypoint; whether that chain works when the image `USER` is non-root is unproven.

## The crux — the uid boundary between host-direct FS and the container

This is the hard part, and the reason it's a project not a flag.

The gateway's `FileSystemManager` writes workspace files **host-direct** (as the gateway
process user — root on the run-host today), and `WorktreeEngine` runs `git` the same way.
The container runs the user's code. So files cross a uid boundary:

```
 gateway / git   ──writes host-direct──▶  worktree files (owned by gateway uid)
 container app   ──writes in-container──▶  same worktree files (owned by container uid)
```

- Container **root** today ⇒ no mismatch (root ignores ownership). This is *why* it "works".
- Container **non-root** ⇒ files the gateway/git created (root-owned) are unwritable by the
  app, and files the app creates (uid 1000) may collide with git's expectations.

Options for closing the boundary (a decision to make, see below):

| Option | Idea | Cost / caveat |
|---|---|---|
| **A. 0777 worktrees** | Mount worktrees world-writable, like the cache mount. | Simplest; loses ownership semantics; umask on new files matters; both sides can write. |
| **B. Match uids** | Run the container as the same uid the gateway/git writes as. | Clean ownership, but ties container uid to the host process; if the gateway is root, that's root again. |
| **C. User namespaces** (`userns-remap`) | Container "root" maps to a host non-root uid. | Best *escape-surface* answer — but inside the container `getuid()==0` still, so **it does NOT fix pulseaudio** (audio needs a genuinely non-zero uid). Solves security, not F3. |
| **D. Gateway runs non-root + fixed container uid** | Both sides are the same non-root uid. | The "correct" end state; largest blast radius (the whole gateway process model). |

Note the subtlety: **security** (Option C) and **audio** (needs a non-zero in-container uid,
Options A/B/D) are *different* requirements. A complete answer may combine them
(userns-remap for escape hardening **and** a non-root in-container user for audio + least
privilege). Phase 0 exists to pin these down before committing.

## Privilege escalation — the "sudo" question

Non-root creates a real need: a user will sometimes need root **in their own sandbox**
(`apt install` at runtime, edit `/etc`, poke `systemctl`). This must be **standard, obvious,
and gated by identity — not by a secret that untrusted in-container code can reuse.** If any
process in the container can silently become root, we've handed back the very blast-radius
reduction non-root buys.

### Principle
Escalation is authorized by the **authenticated owner, through the gateway** — the same
`userOwnsSandbox` boundary that already gates every sandbox route. Not by an ambient
in-container credential.

### The gateway is already the privilege broker
The gateway runs privileged (it owns the Docker socket) and owner-gates every route. "Root in
a sandbox" is just one more gateway capability — `docker exec -u 0 sandbox-<id> …` — surfaced as:
- **Root terminal:** a PTY opened with `-u 0` via the existing `PtyGateway`, as an explicit
  "root shell" tab.
- **Run as root:** a one-shot owner-gated exec (`-u 0`) for a command-palette action / pane.

Only the browser-authenticated owner can open these; a process *inside* the container cannot
(there is no local sudo or password for it to abuse). This reuses the whole existing security
model and introduces **no new in-container secret**.

### Where `sudo` fits (and the password-pane idea)
Three postures for giving classic `sudo` muscle-memory, each a deliberate trade:

| Posture | How | Who can escalate | Cost |
|---|---|---|---|
| **Gateway broker** (recommended) | root terminal / run-as-root via `docker exec -u 0`, owner-gated | only the authenticated human | no `sudo` command — a distinct root affordance instead |
| **Auth-gated sudo password** | per-sandbox random root password in `/etc/shadow`; revealed in an **owner-only "Sandbox access" pane** (auth-gated endpoint, exactly like the preview token) | the human (who sees the pane); container code can't read `/etc/shadow` | copy-paste per `sudo`; a secret to manage |
| **Passwordless sudo + userns** | `sandbox-user` `NOPASSWD` sudo, contained by userns-remap (Phase 4) so container-root == host-*un*privileged | any in-container process (but host-contained) | best UX, weakest in-container isolation |

**On identity:** the auth layer decides *who may escalate* (the `uid` owner); the container OS
user stays `sandbox-user` (fixed per image). A "Sandbox access" pane would say *"you're
authenticated as `<uid>`; container user is `sandbox-user`; here's your root access"* — the
cloud-ide identity gates the door, it isn't the Unix user.

### Recommendation
Ship the **gateway broker** first — a first-class "root terminal" + "run as root", owner-gated,
no secret. It's the soundest fit (privileged ops already live in the gateway) and the safest
(untrusted code has *no* escalation path). Offer the **auth-gated sudo password pane** as an
opt-in for users who want real `sudo`; it keeps escalation tied to the human and `/etc/shadow`
keeps code out. Reserve **passwordless-sudo + userns** for an explicit "trusted/dev" posture,
and only once userns lands.

### Slice (folds into the phases below)
- Backend: a `-u 0` path on the driver + `POST /v1/sandboxes/:id/root-exec` and/or a `?root=1`
  PTY upgrade, behind `requireSandboxOwnership`.
- Frontend: a "root terminal" tab; optionally a "Sandbox access" pane (owner-only route, like
  the preview-token endpoint) that reveals the user + credential.
- Decision: broker-only, or also ship the sudo-password pane? (Lean: broker first, pane as
  fast-follow.)

## Decisions to make (asked, to be answered)

| Question | Options | Lean |
|---|---|---|
| Default posture | non-root by default \| opt-in (display first) \| keep root default + opt-in non-root | **Opt-in for display first**, then flip the default once execd + FS are proven. |
| uid/permission strategy | A (0777) \| B (uid match) \| C (userns) \| D (non-root gateway) \| combo | Start **A** (unblocks fast, matches cache mount); design toward **C+non-root user** for the real security win. |
| Base-image compat | `useradd` (Debian) \| `adduser` (Alpine) \| bases with neither | Support Debian+Alpine (`useradd || adduser`); fail the build loudly on neither. |
| Reconcile the two `bootUpAsRoot` defaults | orchestrator `?? true` vs naming `?? false` | One source of truth; pick per the posture decision above. |
| Privilege escalation | gateway broker \| auth-gated sudo password pane \| passwordless sudo + userns | **Gateway broker first** (owner-gated root terminal / run-as-root), sudo-password pane as opt-in fast-follow. See the section above. |

## Phases / slices

### Phase 0 — Verify the unknowns (cheap, ships nothing) — ✅ DONE, all GREEN
Ran throwaway probes: hand-built a minimal non-root image
(`FROM debian; RUN useradd sandbox-user; USER sandbox-user`) and booted it via the raw
`POST /v1/sandboxes {imageTag}` verb.
- [x] **Daemon honors the image `USER`.** `container_ops.py:403` builds `create_container`
  with **no `user=`** (only forces `entrypoint=[BOOTSTRAP_PATH]`), and live: the booted
  container's `Config.User` = `sandbox-user`, exec runs as `sandbox-user`, state RUNNING.
  The non-root-via-image-USER approach is **viable** — no userns/daemon pivot needed.
- [x] **execd works non-root.** Gateway `POST /exec` on the non-root sandbox streamed
  `stdout: EXECD_OK` + `execution_complete`. bootstrap.sh + execd run fine as `sandbox-user`.
- [x] **Workspace writability confirms Option A.** Default worktree (`0755 root`) → non-root
  write is **Permission denied**. After `chmod 777` → **write succeeds**. So 0777 worktrees
  (mirroring the cache mount) unblock non-root, as planned.

**uid mapping observed (informs Phase 2):** a file the container's `sandbox-user` (uid 1000)
creates shows on the host as owner `karlsefni` (host uid 1000) — i.e. container uid 1000 ==
host uid 1000, while the gateway/git run as **root**. Consequences: root git can read/write
everything (fine); the *container* can only write git-created (root-owned) files if they're
group/world-writable. So Phase 2 is 0777 on the worktree dir **plus** a write-mode/umask
story for git-checked-out files the user edits *inside* the container (the editor's own
writes are host-direct as root, so those are unaffected).

### Phase 1 — Fix the drop-root machinery (make non-root *buildable*)
- [x] `SecurityUserInjector`: create the user only — **no** build-time `chown /workspace` (it
  doesn't exist at build; runtime writability is Phase 2). Idempotent + multi-distro
  (`useradd || adduser`). So `bootUpAsRoot: false` now produces a buildable image.
- [x] Confirmed the assembler's `USER sandbox-user` line lands (single-stage verified via
  generated Dockerfile; multi-stage uses the same `role==='runtime'` gate).
- [ ] **Deferred to Phase 3 — reconcile the `bootUpAsRoot` default.** Three unset-defaults
  disagree: orchestrator `?? true` (drives the build), `contentTag` `?? false` (hash), and
  `ContextManager = true`. Reconciling is entangled with (a) the posture decision (non-root
  by default?) and (b) the **content hash** — flipping `contentTag`'s default invalidates
  every cached image (rebuild storm). So it moves to Phase 3 where the posture is decided,
  and the hash change is rolled out deliberately.

### Phase 2 — Close the uid boundary (make non-root *work*)
- [ ] Worktree mounts writable by the container user (Option A: 0777 on `createWorktree`,
  mirroring `cacheVolumeFor`; or the chosen strategy).
- [ ] Reconcile host-direct `FileSystemManager`/`WorktreeEngine` writes with the container
  uid (umask, ownership, `git` safe.directory as needed).

### Phase 3 — Turn it on (opt-in), validate end to end
- [ ] Display envs default non-root. Full E2E: boots RUNNING, execd works, editor reads AND
  writes files, glxgears renders, **audio plays** (pulseaudio now runs as `sandbox-user`).

### Phase 4 — Security hardening + default flip
- [ ] userns-remap / cap-drop review (pair with the egress `NET_ADMIN` drop).
- [ ] Flip the default to non-root for all envs once proven; document migration (existing
  images are root — a rebuild moves them over). Update `SECURITY.md`.

## Testing / acceptance

- **E2E gate:** a non-root sandbox that (1) boots RUNNING, (2) execs via the gateway, (3)
  writes a file through the editor that git sees, (4) renders glxgears, (5) plays audio.
  Nothing flips the default until this is green.
- **Regression:** explicit `bootUpAsRoot: true` envs still build and run as root unchanged.
- **Unit:** one `bootUpAsRoot` resolver with a truth table; `SecurityUserInjector` emits a
  build-safe user-creation step (no runtime-mount chown).

## Rollout / risk

Land behind **opt-in** (display envs) first — smallest blast radius, and display is where the
concrete pain (audio) lives. Only flip the global default after Phase 3 is green across a few
representative envs (Debian, Alpine, a compiled-language multi-stage build). Existing root
sandboxes are unaffected until rebuilt.

## Out of scope (for this branch)

Gateway-side identity/IDOR (that's `SECURITY.md`), the display transport itself, and the
egress layer — this branch is strictly the **in-container privilege model** and the file
permission boundary it implies.
