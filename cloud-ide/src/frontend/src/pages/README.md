# 📄 Pages (route views)

Top-level route views, mounted by `router.tsx` inside `AppShell.tsx`.

| Page | File | What |
|---|---|---|
| **Sandboxes** | `Sandboxes.tsx` | The sandbox **control plane** — see below. |
| **Environments** | `Environments.tsx` | Build/manage environments (images the sandboxes boot from). |
| **IDE Workspace** | `IDEWorkspace.tsx` | The editor + terminal for an open sandbox. |
| **Health** | `Health.tsx` | Renders `GET /api/health` — per-subsystem status. |

---

## 🎛️ Sandboxes control plane (`Sandboxes.tsx`)

Lists the sandboxes the caller owns; clicking one opens a **detail drawer** that makes
the **sandbox ↔ session** distinction legible and manages lifecycle. Frontend client:
[`../api/sandbox.ts`](../api/sandbox.ts). Every `:sandboxId` route below is owner-gated
by the backend router (404 for non-owners — see backend
[SECURITY.md](../editor/SECURITY.md)).

### The drawer

| Tab | Shows | Backend |
|---|---|---|
| **Overview** | State, ids, created/active, lifecycle actions (open / pause / resume / delete) + **session history** | `GET /:id`, `GET /:id/sessions`, `POST /:id/pause`·`/resume`, `DELETE /:id` |
| **Settings** | Read-only config from the environment (image, env vars, volumes) | — (from the environment) |
| **Logs** | Segmented **Activity \| Container** | below |
| ↳ Activity | Audit trail: created / state / session attach·leave, newest-first | `GET /:id/activity` |
| ↳ Container | Live `docker logs -f` stream | `GET /:id/logs` |

### Concepts that drive the design

- **Sandbox ≠ session.** A sandbox is the owned, immutable container (lifecycle, volumes,
  one worktree). A session is a browser attachment; many sessions → one sandbox, and
  ending a session never destroys compute (the `IdleSweeper` owns that).
- **A sandbox is immutable.** Config lives on the *environment*; rebuild to change it —
  so **Settings is read-only**. No per-instance env/idle dials (drift = 3am pager).
- **Launch goes through `POST /v1/sessions`, not `POST /v1/sandboxes`.** The session
  path reuses this user's warm (`RUNNING`/`PAUSED`) sandbox for the env; the raw verb
  double-provisions. Opening from this page routes through that shared launch flow.
- **Identity is the `uid` cookie** (persisted 1 year). Lose it and you lose reuse — the
  workspace looks empty because a new identity owns no sandboxes.

### Terminal

The IDE terminal (in `IDEWorkspace`) picks its transport from
`GET /v1/sandboxes/capabilities`: an interactive **PTY** over `WS /:id/pty` when the
driver supports it (default), else line-mode SSE. See the backend
[TERMINAL_BACKEND.md](../../../backend/TERMINAL_BACKEND.md).

Backend counterparts: [backend/README.md](../../../backend/README.md) (subsystem table),
`controllers/SandboxController.ts`, `api/SandboxRoutes.ts`.
