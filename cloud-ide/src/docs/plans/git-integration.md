# Git Integration — plan

Status: approved (decisions taken 2026-07-18). Branch: `feat/git` (pushed to origin).
**COMPLETE & MERGEABLE**: engine + credentials + GitRoutes + GitHubBrowse (all tested), the
frontend Source Control pane, clone-on-create, and the scratch-island deletion. Host-folder
source is **DROPPED, not deferred** (2026-07-23) — see the decision table below;
`LocalMountStrategy` is deleted with it.
Related: [sandbox-privileges.md](./sandbox-privileges.md) (non-root uid debt this deliberately sidesteps),
[workspace-entity.md](./workspace-entity.md) (git becomes one workspace *source* under that entity).

## Goal

Real version control on the worktree, exposed to the user: **clone** a GitHub repo and run
the **full git surface** (status / stage / commit / push / branch / diff / log) — plus an
optional read-only **repo browser** that never clones. (A third goal, "use a host folder",
was dropped — see the decision table.)

The driving constraint: **minimal memory + compute**. A "lightning-fast git that is still
full git." The two ideas the user wanted to mix — GitHub REST and real git — resolve into
one spectrum, not a compromise.

## The key decision: partial clone, not REST-as-git

`git clone --filter=blob:none <url>` (blobless partial clone) is the whole feature:

- **Lightweight** — clones the commit graph + trees only, not file blobs. A huge repo is
  seconds and megabytes.
- **Lazy** — git fetches a blob from the remote *only* when a command needs that file's
  content (open / diff / checkout). This is the user's "only call when you operate on it,"
  and it is native git, not something we build.
- **Still full git** — branches, merge, history, `status`, `log` all real, because it *is*
  git in the worktree the editor and terminal already write to. One source of truth.
- **The PAT is the credential** — it authorizes both the lazy blob fetches and `push`. That
  is the GitHub-API connection, used the way git already knows how to use it.

Rejected: the old frontend `github.ts` (browser Octokit + PAT). It can only do single-file
REST commits, needs a token in the browser, and knows nothing about the mounted worktree —
a parallel, weaker source of truth. Its one reusable idea (read-only tree + content) moves
server-side as the browse mode below. See "Deleted" — it is scratch, wired to nothing.

| Mode | Disk/compute | For |
|---|---|---|
| **REST browse** (no clone) | ~zero | Peek at a repo tree + a file, read-only. Pure GitHub REST. |
| **Blobless clone** (`--filter=blob:none`) | tiny + lazy | Real git: edit, commit, branch, push. Blobs stream on demand. |

You "upgrade" browse → clone the moment you want to write. Same PAT throughout.

## Decisions (asked & answered)

| Question | Decision |
|---|---|
| Where does git logic live? | **Backend real git.** `WorktreeEngine` already shells to `git`; extend it. Not browser-REST. |
| Where do git ops run? | **Host-side** (backend route → host `git` in the worktree → push with the PAT). Keeps the PAT server-side and sidesteps the non-root in-container uid debt (privileges Phase 2.1) entirely. |
| Lightweight mechanism | **`--filter=blob:none` partial clone** + git's native lazy blob fetch. |
| GitHub REST client | **Native `fetch`**, not `octokit`. Two GET calls (getTree/getContent) do not need a heavy dep. Drop `octokit`. |
| Host folder | ~~Revive `LocalMountStrategy`~~ → **dropped** (2026-07-23, see below). |

**Host folder — dropped, and why.** The original plan was to revive `LocalMountStrategy` and
bind a host dir into the sandbox. Four things were wrong with that:

1. **The daemon rejects it.** `boot.js` resolves `allowed_host_paths` to exactly
   `<dataDir>/worktrees` and `<dataDir>/caches`. Honouring a caller-supplied path means
   widening that list, i.e. letting an HTTP request name any server directory to bind into a
   tenant's container — other tenants' worktrees, the encrypted PAT store, `/etc`.
2. **The git surface can't see it.** Every `WorktreeEngine` method derives its cwd as
   `path.join(this.worktreesRoot, sandboxId)`. A mount outside that root is invisible to
   status/commit/diff/push — and `isDirty` treats a missing path as *clean*, so destroy()'s
   unsaved-work pre-flight would silently pass for every host-folder sandbox.
3. **`LocalMountStrategy` was the wrong tool anyway.** It emits a `kind: 'user'` volume, and
   `normalizeUserVolume` force-mounts those under `/workspace/mounts/<name>` and explicitly
   throws on `/workspace`. It could never have produced the workspace root.
4. **It inverts the durability contract.** "The checkout is disposable, the branch is
   durable" is the invariant `WorktreeEngine.test.ts` defends. A host folder is user-owned
   and possibly a real repo with its own remote — the mounted thing becomes the durable one.

In a browser IDE the "host" is the **server**, not the user's machine, so this only ever
served someone running the whole stack locally. A local repo is reachable as a `git-url`
source instead (git clones from a filesystem path; `authForUrl` already tolerates a non-URL
remote), which lands it in the allow-listed worktrees root with the full git surface intact.
Pushing back into a non-bare local repo needs `receive.denyCurrentBranch=updateInstead` on
that repo.

## Architecture

```
┌ browser ─────────┐   HTTP   ┌ gateway (host) ──────────────────────┐
│ Source-Control   │ ───────► │ GitRoutes → WorktreeEngine git ops    │
│ pane + optional  │          │   git <cmd> in worktrees/<id>/        │
│ repo browser     │ ◄─────── │ + GitHubBrowse (fetch → api.github)   │
└──────────────────┘          │ PAT: server-side credential helper    │
                              └───────────────────────────────────────┘
                                        │ worktree bind-mounted /workspace
                                        ▼  (same tree editor + terminal write)
                                   sandbox container
```

- **`WorktreeEngine` (extend):** `cloneInto(id, url, pat)` → `git clone --filter=blob:none`
  into the worktree path, next to `createWorktree`. Plus thin real-git wrappers:
  `status / add / commit / push / branch / diff / log`, all `cwd` = the worktree.
- **PAT storage:** server-side, per-user, **encrypted at rest** (`GitCredentialStore`,
  AES-256-GCM, key HKDF-derived from `AUTH_SECRET` — env-only in prod, so a data-dir leak
  alone can't decrypt). The token never reaches the browser.
- **Credential delivery:** the PAT rides as a **host-scoped** `-c http.<host>.extraHeader`
  Authorization header — never in the remote URL or `.git/config` (so not exposed to the
  container that mounts the checkout). git exports `-c` values in `GIT_CONFIG_PARAMETERS`,
  so a blobless clone's **implicit lazy blob fetch inherits it** — private-repo lazy fetch
  is seamless with nothing persisted to disk. (Verified: `GIT_CONFIG_PARAMETERS`
  propagation to git subprocesses.) This resolves the earlier "implicit fetch can't take
  `-c` args" concern.
- **`GitHubBrowse` (DONE, backend):** `getTree(owner,repo)` + `getContent(owner,repo,path)`
  via native `fetch` (no octokit — two GETs don't need it). The salvaged core of the old
  `github.ts`, server-side. Trees endpoint takes a branch name directly (one meta call for
  the default branch, one for the recursive tree). Caller's stored PAT authenticates
  private repos; SSRF-bounded (fixed host, per-segment URL-encoding, slug-validated
  owner/repo). Mounted user-scoped at `/api/v1/git/browse/:owner/:repo/{tree,content}`.
- **`GitRoutes` (DONE):** `GitController` + REST surface. Sandbox-scoped ops
  (`status`/`log`/`branch`/`diff`/`stage`/`commit`/`push`/`pull`) mount inside
  `createSandboxRouter` under its structural `/:sandboxId` ownership guard; user-scoped
  `GET/PUT/DELETE /api/v1/git/credential` mount in server.ts (keyed by `req.userId`, no
  sandbox guard). Each op resolves `sandboxId → record.worktreeId` before touching the
  engine (the worktree dir is named by worktreeId). git failures map to 400 with stderr;
  no-worktree → 409.

## Deleted (dead scratch, unreachable from `main.tsx → AppShell`) — DONE

- `frontend/src/github.ts`, `github.js` — REST logic salvaged into backend `GitHubBrowse`.
- `frontend/src/IconTest.tsx`, `FileExplorerTest.tsx`, `App.tsx` — scratch harnesses.
- `octokit` from `frontend/package.json` (only the island used it).
- `backend/src/workspace/WorkspaceManager.ts` — empty stub (commit 78b34b0).

## Clone-on-create — DONE

`SandboxManager.provision(spec, owner, existingWorktreeId?, source?)` gained a `WorkspaceSource`
(`{ kind: 'clone', url, auth }`): a FRESH worktree is `cloneInto`'d from the URL instead of minted
empty; recovery (existingWorktreeId) never clones. `POST /v1/sessions` accepts `repoUrl`, resolves
the caller's PAT, and **rejects non-http(s) URLs** at the boundary (git's `ext::`/`file::` transports
run commands on the host). Frontend: a "Clone repo" dialog on the Sandboxes page (repo URL + built-env
picker) → `launchEnvironment(env, { fresh, repoUrl })`.

`GitStrategy` (clone *inside* the container post-boot) stays dead: the clone belongs on the
host so it is mounted + durable, not inside an ephemeral container.

## Phases

1. **Backend** — `WorktreeEngine.cloneInto` + git-ops wrappers + PAT credential + `GitRoutes`
   + `GitHubBrowse`. Tests alongside.
2. **Frontend** — Source-Control pane (status / stage / commit / push) + optional read-only
   repo browser, built with the frontend-design plugin. Delete the scratch island.
