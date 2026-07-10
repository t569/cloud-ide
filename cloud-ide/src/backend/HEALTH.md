# 🩺 Subsystem Health — `GET /api/health` + `/health`

One endpoint that asks every subsystem whether it is actually working, and one page
that draws the answer. Backed by `src/api/HealthRoutes.ts`, rendered by
`frontend/src/pages/Health.tsx`, typed by `shared/types/health.ts`.

---

## 📐 The contract

```jsonc
{
  "status": "ok",                      // worst status across every check
  "uptimeSec": 4213,
  "timestamp": "2026-07-10T14:27:00.127Z",
  "checks": [
    { "name": "docker", "status": "ok", "detail": "daemon 27.3.1", "latencyMs": 9 }
  ]
}
```

| Status | Meaning | HTTP |
|---|---|---|
| `ok` | working | 200 |
| `degraded` | serving, but something is wrong or missing | 200 |
| `down` | this subsystem cannot do its job | **503** |

**200 for `degraded`, 503 only for `down`.** A load balancer must evict the node on a
real outage, but an amber card is not an outage — grading it 503 would take a serving
fleet offline over a paused sandbox.

Every probe runs **in parallel** with its own **3s timeout**. A probe that throws or
hangs becomes `down`; it never propagates. A health endpoint that dies alongside its
dependencies reports nothing at the exact moment it matters most.

---

## 🔍 What is probed

| Probe | Reaches | `down` when | `degraded` when |
|---|---|---|---|
| `preflight` | `config/env.ts` | `AUTH_SECRET` unset in production — identity cookies are forgeable | `FRONTEND_ORIGIN=*` (incompatible with credentialed CORS) |
| `opensandbox` | the lifecycle daemon over HTTP | connection fails (the real `errno` is surfaced, not `fetch failed`) | daemon answers 5xx |
| `docker` | `docker version` | CLI missing, or the daemon is unreachable | — |
| `build-store` | `IBuildStore` | `all()` throws, or `ready` rejects | — |
| `persistence` | `IEnvironmentRepository` | the JSON repos cannot be read | — |
| `sandboxes` | `ISandboxRepository` | the repo cannot be read | any sandbox stuck in `ERROR` |
| `vfs` | worktrees root, `git`, bare repo | root not writable, or `git` not on `PATH` | — |
| `sandbox-driver` | `ISandboxDriver.capabilities()` | — | the driver cannot `exec` |

`docker version` is used rather than `--version` because only the former round-trips to
the daemon; `--version` prints happily while Docker is dead.

`opensandbox` treats **any** HTTP status below 500 as proof of life. It deliberately does
not assert that `GET /v1/sandboxes` exists — a 404 still means the daemon is listening and
routing, and coupling the health check to a route's existence makes it lie the day the
daemon's API moves.

### Two verdicts tuned so the board doesn't cry wolf

- **`pty=false` is `ok`.** It is the default (`opensandbox`) driver's advertised shape,
  not a fault. Grading it `degraded` would leave every healthy install permanently amber,
  and an amber board that is always amber is a board nobody reads.
- **A missing bare repo is `ok`.** `WorktreeEngine` bootstraps `data/central-repo.git`
  lazily on first provision, so its absence on a fresh install is normal. The card says
  `pending first provision`.

### What is *not* probed, on purpose

`FsEventHub` is an in-process `EventEmitter`; `WorkspaceWatchers` is an in-memory
ref-count `Map`. Neither can be "down" while the health handler is answering — a probe
there asserts only that `new Map()` works. `FileSystemManager` is stateless (host-direct
`node:fs`), so the thing that can actually fail is the storage under it: that is the
`vfs` probe.

---

## ➕ Adding a probe

A probe resolves with a verdict, or throws. Throwing (or hanging past the timeout) is
`down` — you never construct that status yourself.

```ts
// src/api/HealthRoutes.ts → systemProbes()
redis: async () => {
  const pong = await client.ping();          // throws → down, with the error as detail
  return pong === 'PONG' ? ok('reachable') : degraded(`unexpected reply: ${pong}`);
},
```

That is the whole change. The frontend renders `checks[]` generically, so a new probe
lights up a new card with no UI work.

Two rules learned the hard way:

1. **Put the evidence in `detail`.** `"fetch failed"` tells an operator nothing; Node
   hides the real cause in `Error.cause`. The `opensandbox` probe unwraps it to
   `http://127.0.0.1:8080/v1 unreachable: ECONNREFUSED`.
2. **Never grade a normal state `degraded`.** If a fresh, healthy install would show
   your probe as amber, the verdict is wrong, not the install.

---

## 🖥️ The page

`/health` in the SPA. One card per check, polled every 10s, with the overall pill in the
header. It reads `checks[]` and knows nothing else — the backend owns what a subsystem is
and whether it is healthy.

`frontend/src/api/health.ts` exists for one reason: `apiClient` throws on a non-2xx, and
a `down` report arrives as 503. The body is still the full report, and it is the one you
opened the page to read, so the 503 is unwrapped rather than surfaced as a network error.

---

## 🗺️ Roadmap

- [ ] **Disk-full detection.** `vfs` uses `fs.access(W_OK)`, which catches a missing
  directory, a bad cwd and a read-only mount — but *not* a full disk. A write-then-unlink
  probe would; add it when disk-full actually bites (`ponytail:` comment marks the spot).
- [ ] **Auth.** The report leaks driver name, `NODE_ENV`, and admin-token state. Fine
  behind a private network; put it behind `requireAdmin` before exposing the board
  publicly. The liveness signal (the HTTP status) needs no auth and can stay open.
- [ ] **Per-sandbox health.** Today `sandboxes` reports a census. Probing each sandbox's
  execd is a different endpoint (and a different cost model) — it does not belong here.
