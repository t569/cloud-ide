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
- [x] **Backend root PTY (broker).** `PtyOptions.user` → `DockerPtyDriver` adds `-u <user>`;
  `PtyGateway` reads `?root=1` → `user:'root'`, authorized purely by the existing
  `userOwnsSandbox` check on the upgrade (no new gate — the owner's own privilege, unreachable
  from inside the container). Root sessions are keyed apart in the `PtyRegistry` so they never
  cross-attach to a normal shell. Verified: default exec = uid 1000, `-u 0` = uid 0.
- [x] **Frontend "root terminal" tab** — an amber shield-key `TerminalTabs` entry that opens
  the WS with `&root=1` (`createTerminalTransport({root:true})` → `PtyGateway -u 0`). Guarded to
  PTY drivers, titled `root-N`, keyed apart from normal shells. Broker complete end to end.
- [ ] One-shot **run-as-root** (`POST /:id/root-exec`) for a command-palette action — optional.
  Works under the hardened posture (it's a broker `docker exec -u 0`, not setuid), so this is
  the natural replacement for the retired sudo pane's muscle-memory if wanted.
- [~] **Sudo-password pane — BUILT, THEN REMOVED (Phase 4 finding).** A "Sandbox access" pane
  revealed an owner-gated, HMAC-derived root password and applied it via `chpasswd` (+ a
  `Defaults rootpw` sudoers drop-in) so `su -` / `sudo` worked in a normal shell. The container
  mechanics verified live on a container **without** `no-new-privileges`. But **real sandboxes
  run with `--security-opt no-new-privileges:true`** (the OpenSandbox daemon default), and
  `su`/`sudo` are **setuid-root** — the whole point of NNP is to stop a setuid binary from
  elevating. Verified live under the true posture: `sudo` → *"the 'no new privileges' flag is
  set, which prevents sudo from running as root"*, `su` → *"Authentication failure"*. So the
  pane could never work in a real sandbox without dropping NNP, and dropping a keystone hardening
  for a convenience feature is the wrong trade for a branch whose whole job is shrinking blast
  radius. **Removed** (endpoint, `sandboxRootPassword`, pane UI, activity item). The gateway
  broker below is the sound escalation path — it survives NNP because the daemon spawns the
  uid-0 process directly (verified: `docker exec -u 0` → `uid=0`, writes `/etc`, under
  `no-new-privileges:true`).
- Decision: **gateway broker only** (root terminal; optional one-shot run-as-root). The
  setuid sudo-password pane is incompatible with the hardened default and was retired.

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
- [x] **Verified live:** a `bootUpAsRoot:false` env builds cleanly (no `chown` failure) and
  ships as `Config.User=sandbox-user` / `uid=1000(sandbox-user)`.
- [ ] **Deferred to Phase 3 — reconcile the `bootUpAsRoot` default.** Three unset-defaults
  disagree: orchestrator `?? true` (drives the build), `contentTag` `?? false` (hash), and
  `ContextManager = true`. Reconciling is entangled with (a) the posture decision (non-root
  by default?) and (b) the **content hash** — flipping `contentTag`'s default invalidates
  every cached image (rebuild storm). So it moves to Phase 3 where the posture is decided,
  and the hash change is rolled out deliberately.

### Phase 2 — Close the uid boundary (make non-root *work*)
- [x] **Worktree writable by the container user.** `WorktreeEngine.createWorktree` now
  `chmod -R a+rwX`'s the checkout (both fresh and recovery paths), keeping it root-OWNED so
  the gateway's root `git` sees no ownership change. A non-root container can now read, edit,
  and create in `/workspace`. Same permissive single-tenant posture as the 0777 cache mount.
  **Verified live:** a `bootUpAsRoot:false` sandbox `touch`/`echo >`/`mkdir`s in `/workspace`
  with no manual chmod (all WROTE; files owned by `sandbox-user`) — the Phase-0 "Permission
  denied" is gone.
- [x] **Phase 2.1 — edit/build write parity.** The `a+rwX` covered only the INITIAL checkout;
  files the gateway CREATES afterward (IDE saves via `FileSystemManager.writeFile`, the sole
  post-checkout working-tree writer) came back root-owned 0644 / new dirs 0755 — read-only to
  the container's `sandbox-user` (uid 1000), so an in-container `npm install` / build / terminal
  editor couldn't rewrite what the IDE just wrote. `writeFile` now chmods the new file 0666 and
  every directory it created 0777 (root-OWNED still; `chmod` is umask-exact where a create-`mode`
  isn't), the same single-tenant posture as the 0777 cache mount. Scoped to the VFS choke point —
  the auth secret (`auth.ts` 0600) stays untouched, so no process-wide umask change.
  **Verified:** posix unit test asserts 0666/0777; and live — a uid-1000 container `>>`-appends a
  gateway-written 0666 file and `touch`es into a 0777 gateway-created dir (both **WROTE**), where
  the pre-fix 0644/0755 equivalents are **DENIED**.
- **In-container `git` is a NON-GOAL here (scoping decision), not deferred parity.** A linked
  worktree's gitdir lives in the shared `central-repo.git`, which holds EVERY sandbox's branches
  and is deliberately NOT bind-mounted in (doing so would leak all tenants' history into one
  container). So in-container `git` can't reach its gitdir at all — it's structural, not a
  `chmod`/`safe.directory` fix. Git stays a **gateway broker** (host-direct), the same pattern as
  the privilege broker. A real "git in the terminal" feature would need a per-sandbox standalone
  git dir mounted in — its own workstream, out of scope for the privilege model.

### Phase 3 — Turn it on (default flip), validate end to end
- [x] **Default flipped to non-root.** `StageOrchestrator` (both single- and multi-stage) and
  `ContextManager` now default `bootUpAsRoot: false`. Every env without an explicit
  `bootUpAsRoot:true` builds non-root; `true` stays the escape hatch (runtime-root needs, exotic
  bases). **Cache handled for free:** `contentTag` hashes the generated Dockerfile (`recipe`,
  `BuildService.ts:188`), and non-root changes the Dockerfile (adds `useradd`/`USER`), so the
  content hash changes → existing envs rebuild correctly on next build. No epoch bump / rebuild
  storm.
- [x] **F3 payoff proven at the daemon level.** Verified live: an env with no `bootUpAsRoot`
  boots as `sandbox-user`; the root terminal (`-u 0`) escalates to `root`; the worktree is
  writable; and **`pulseaudio -D` starts as uid 1000** (`PULSE_RUNNING_AS_NONROOT`) where it
  died as root — so the audio tap comes up. The only piece left is the *perceptual* browser
  check (open a display env's pane and hear the SFX), which is a manual gate.
- [~] **Sudo-password pane — built then removed** (incompatible with `no-new-privileges`; see the
  escalation slice above). The **root terminal broker** is the escalation surface.
- [x] **Follow-up: Phase 2.1 edit/build write parity** — done (see Phase 2 above). In-container
  `git` ruled a non-goal (scoping decision there), not a pending item.
- [x] **Follow-up: migrate existing root sandboxes — verified in the wild, no code.** Migration
  is the Phase-3 rebuild primitive: a rebuild regenerates the (now non-root) Dockerfile → new
  content-hash tag → non-root image → `:latest` repointed. **Proven live on the fleet:** env
  `1ht0hf9dl2` carries a *stale* root tag (`3e3d36f95718d714`, `Config.User=[]`) alongside a
  newer non-root `:latest` (`c36b64e10ea71f5f`, `USER=sandbox-user`) — a completed root→non-root
  migration, old root tag left as dangling history. Launch boots the stored `env.imageName`
  and never rebuilds (SessionController gate), so migration is strictly **opt-in per env** (no
  rebuild storm, per Rollout): an env stays root until *its* next rebuild; a running/paused root
  sandbox stays root until destroyed + re-provisioned from the rebuilt image. Envs still root as
  of this writing (`lshi1xh8ex`, `olio24wf0b`, `2nr53zc407`, `01ouek0r6h`) move over on their
  next build. Root/non-root is purely an image property (the daemon honors `Config.User`,
  Phase 0) — there is no sandbox-side migration code to write.

### Phase 4 — Security hardening — ✅ REVIEW DONE
The default flip already landed in Phase 3; Phase 4 is the hardening **review**. It found the
runtime posture already strong (the egress workstream + Phase 3 non-root did the heavy lifting)
and surfaced one real conflict (the sudo pane). Inspected a live sandbox's `HostConfig`:

- [x] **Posture inventory (already in place, via the OpenSandbox daemon + `.sandbox.toml`):**
  `Privileged=false`, `CapAdd=[]`, `SecurityOpt=[no-new-privileges:true]`, seccomp = Docker
  builtin, `PidsLimit=512`, non-root `USER=sandbox-user` (Phase 3), egress sidecar holds the
  only `NET_ADMIN`. `CapDrop` = `[AUDIT_WRITE MKNOD NET_ADMIN NET_RAW SYS_ADMIN SYS_MODULE
  SYS_PTRACE SYS_TIME SYS_TTY_CONFIG]`.
- [x] **cap-drop review — current curated list is correct; do NOT tighten to `cap-drop=ALL`.**
  `--cap-drop` removes caps from the **bounding set**, so a cap dropped there can't be regained
  *even by root* obtained through the broker. The broker's #1 use case is `sudo apt install`,
  and dpkg needs `CHOWN`/`DAC_OVERRIDE`/`FOWNER`/`FSETID` — all deliberately KEPT. The list
  drops exactly the escape-dangerous caps (`SYS_ADMIN`, `SYS_PTRACE`, `SYS_MODULE`, `NET_ADMIN`,
  `NET_RAW`, `MKNOD`, `SYS_TIME`, …) while preserving what legitimate in-sandbox root needs. No
  change warranted.
- [x] **`no-new-privileges` vs the sudo pane (the finding).** NNP is a keystone hardening (stops
  untrusted in-container code abusing *any* setuid binary to escalate) and stays ON. It makes the
  setuid `su`/`sudo` pane impossible; the pane was removed (escalation slice). The gateway broker
  is unaffected — the daemon spawns uid-0 directly, not via setuid. Verified both live.
- [x] **userns-remap — deferred (opt-in extra-hardened posture), not defaulted.** The non-root
  `USER` already delivers most of the escape-surface reduction *and* keeps audio (userns keeps
  in-container `getuid()==0`, which is why the plan's Option C "doesn't fix pulseaudio"). Enabling
  `userns-remap` is a **host `daemon.json`** change (not repo config), shifts container uids on the
  host (complicating the uid-parity Phase 2 relies on — though the world-writable 0666/0777 posture
  would still function), and buys only marginal defense-in-depth on top of an already non-root +
  NNP + seccomp + cap-dropped container. Reserve it for an explicit hardened-node posture.
- [x] **Default flip** — done in Phase 3 (non-root default; `bootUpAsRoot:true` is the escape hatch).
- [x] **`SECURITY.md` updated** — runtime privilege model + this posture recorded there, pointing here.

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
