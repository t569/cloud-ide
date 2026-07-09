# Cloud IDE - OpenSandbox Daemon

This directory manages the local execution engine for the Cloud IDE. 

**Current Engine:** Alibaba's `opensandbox`
We are currently utilizing Alibaba's OpenSandbox as our underlying container orchestration daemon. It provides the isolated, heavily restricted Docker environments required to safely execute user code without compromising the host machine.

### Automated Boot
You do not need to boot this manually. The engine is automatically wired into the root monorepo startup sequence.

When you run `npm run dev` at the project root, the `boot.js` script will:
1. Verify Docker is active on your machine.
2. Create an isolated Python `sandbox-env` (if it doesn't exist).
3. Install dependencies from `requirements.txt`.
4. Boot the server using the `.sandbox.toml` configuration.


### 🛠️ Manual Boot (Using `uv`)

If you need to isolate the daemon for debugging or prefer not to run the full monorepo stack, you can boot the OpenSandbox server manually. We use `uv` for blazing-fast Python dependency management.

**Prerequisites:** If you only start the environment via the root `npm run dev` command, you **do not** need to install anything manually—our boot script will automatically provision a local copy of `uv` for you. 

However, if you want to boot the sandbox manually or add new Python dependencies to the `requirements.txt`, you should install `uv` globally on your system for the best developer experience:

**macOS / Linux:**
```bash
curl -LsSf [https://astral.sh/uv/install.sh](https://astral.sh/uv/install.sh) | sh
```

**Windows (PowerShell)**
```powershell
powershell -ExecutionPolicy ByPass -c "irm [https://astral.sh/uv/install.ps1](https://astral.sh/uv/install.ps1) | iex"
```

(Note: You may need to restart your terminal after installing).


**1. Create the Virtual Environment:**
Navigate to the `src/opensandbox` directory and use `uv` to create the environment.
```bash
cd src/opensandbox
uv venv sandbox-env
```

**2. Activate the Virtual Environment:**

* **Windows (PowerShell/CMD)**

```bash
sandbox-env\Scripts\activate
```

* **macOS/Linux**

```bash
source sandbox-env/bin/activate
```

**3. Install Dependencies:**

Use `uv pip` to resolve and install the requirements instantly

```bash
uv pip install -r requirements.txt
```

**Start the Daemon:**
Once installed, boot the server using our specific TOML configuration.

```bash
opensandbox-server --config .sandbox.toml
```




**Requirements:** * Docker Desktop must be running.
* Python 3.8+ must be installed.

---

## Engine API contract — audit (2026-07-09)

Our client (`backend/src/services/sandbox/openSandboxEngine.ts`) was written against an
imagined daemon API, and the Rust it was ported from (`src-rust`) had the same fiction.
Both test suites mocked the imagined shape, so they passed while the real daemon rejected
us — the tests were the reason this survived so long.

Ground truth is upstream `server/opensandbox_server/`: `api/schema.py` (pydantic models),
`services/validators.py`, `services/docker/{docker_service,volumes}.py`, `config.py`,
and `specs/sandbox-lifecycle.yml`. **Check a claim against those before changing the
engine — do not trust `src-rust` as a reference; it is where the fiction came from.**

A–F, I and J are fixed. G is deliberately deferred (k8s-only feature) and H needs no code
— both carry the trigger that should reopen them.

### A. Boot 400 — `allowed_host_paths = []` rejects every bind mount **[FIXED]**

`.sandbox.toml` carried upstream's example comment: *"If empty, all host paths are
allowed."* The code says the opposite — `config.py`: *"If empty, host bind mounts are
rejected."* `validators.ensure_valid_host_path` guards with `if allowed_prefixes is not
None`, so `[]` matches zero prefixes and raises 400 `HOST_PATH_NOT_ALLOWED`.

Every `SandboxManager.provision()` injects the `git-worktree-workspace` host mount, so
**every boot** hit this. Fixed in `boot.js` — it resolves the worktrees dir and writes a
config with a real allowlist. The upstream example comment is simply stale.

### B. `status.ip` does not exist — the sandbox IP is a fabrication **[FIXED]**

`SandboxStatus` is `{state, reason, message, lastTransitionAt}`. The string `ip` appears
nowhere in `schema.py` or `docker_service.py`. The daemon never returns a container IP.
It broke: `mapStatus()`'s `ipAddress`, the `activeSandboxes` table, `getSandboxIp()`,
`resolveExecEndpoint()`'s unreachable fallback, `SandboxRecord.ipAddress`, and
`PreviewRoutes` (which could never resolve a route).

Fixed by deleting the IP table and `getSandboxIp()` outright and replacing them with
`ISandboxDriver.resolveEndpoint(sandboxId, port)` — a thin wrapper over
`GET /sandboxes/{id}/endpoints/{port}`, the only supported way into a sandbox. Preview
ingress and execd both route through it. `ipAddress` is gone from `SandboxStatus` and
`SandboxRecord`; `OpenSandboxExecClient` now takes a resolved base URL, not `(ip, port)`.
There is deliberately **no fallback** — if the daemon can't resolve the port, nothing can.

### C. State mapping is incomplete **[FIXED]**

The field is `status.state`, not `status.phase`. The enum is `Pending | Running | Pausing
| Paused | Resuming | Stopping | Terminated | Failed`. The old table omitted `Pausing`,
`Resuming`, `Stopping`, `Terminated`, `Failed` — all fell through to `ERROR`.
`Resuming → ERROR` broke wake-on-demand; `Terminated → ERROR` broke IdleSweeper
reconciliation. Now a single lowercased lookup covering all eight, with unknown → `ERROR`
(the spec warns new states may be added).

### D. Resource limits are silently ignored — sandboxes run uncapped **[FIXED]**

`ResourceLimits` is `RootModel[Dict[str, str]]` read via `.get("cpu")` / `.get("memory")`
as Kubernetes quantities (`"500m"`, `"512Mi"`). We sent `{cpuCount: "1", memoryMb: "512"}`.
Pydantic accepts any keys; `parse_nano_cpus(None)` and `parse_memory_limit(None)` return
`None` and only log a warning. **Containers were booting with no CPU and no memory cap** —
a containment hole in a system whose entire job is running untrusted code, and nothing
surfaced it. Now sends `{cpu: "1", memory: "512Mi"}`. The `Mi` suffix is load-bearing: a
bare `memory` quantity is interpreted as *bytes*.

### E. `image.pullPolicy` and top-level `exposedPorts` are not API fields **[FIXED]**

`ImageSpec` is `{uri, auth}`; `CreateSandboxRequest` has no `exposedPorts`. Pydantic
defaults to `extra="ignore"`, so both were silently dropped — never the 400, but
`SandboxSpec.exposedPorts` was a no-op. Both removed from the payload; ports are reached
via `resolveEndpoint()`. `SandboxSpec.exposedPorts` is still declared but unused.

### F. `normalizeVolumeName` emitted illegal names **[FIXED]**

`SandboxManager.normalizeVolumeName` allowed uppercase and `_`. The server enforces
`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 chars, and 400s otherwise. The name arrives
from `POST /sandboxes/:id/volumes` unvalidated, so `My_Data` reached the daemon and was
rejected. Now lowercased, non-label chars → `-`, hyphen runs collapsed, leading/trailing
hyphens stripped, capped at 63 (trailing hyphens stripped *after* the cut, since a
63-char truncation can land on one). Our built-in `git-worktree-workspace` was always
legal, which is why only user volumes tripped it.

### G. `Endpoint.headers` is dropped — **deliberately not fixed**

`Endpoint` is `{endpoint, headers}` with `additionalProperties: false` (the old
`data.url` / `data.address` fallbacks never existed and are gone). `headers` is populated
only when `secureAccess: true`, which upstream supports *only* for Kubernetes sandboxes
behind an ingress gateway. We run the Docker runtime with `[ingress] mode = "direct"`, so
`headers` is always absent. Forwarding it now would be speculative. **Fix this the same
day anyone enables `secureAccess` or moves to the k8s provider** — exec will 401 until it
is forwarded as request headers to execd.

### H. Boot is nominally async — **no action needed**

`POST /sandboxes` returns **202**, which suggests async provisioning. It isn't, on Docker:
`docker_service._provision_sandbox` runs in a thread that the handler `await`s, and the
response is built with a hard-coded `SandboxStatus(state="Running", reason=
"CONTAINER_RUNNING")` only after the container has started. So `provision()` never
observes `Pending`. The k8s provider does not make this guarantee — if we move to it,
`provision()` must poll `getStatus()` until `RUNNING` before handing the sandbox to a
session.

### I. `timeout: 3600` was a wall-clock kill switch **[FIXED]**

`timeout` is an **absolute deadline from creation**, not an idle timer, and the daemon
arms a `threading.Timer` to terminate at it (`_schedule_expiration`). Every sandbox died
one hour after boot no matter how actively it was being used. Worse, IdleSweeper then saw
the container as `STOPPED` and called `destroy()`, deleting the record *and the worktree*
(a dirty worktree throws `DirtyWorktreeError` and is spared, so uncommitted work survived
— clean ones did not).

Now sends `timeout: null` (auto-expiry disabled). IdleSweeper owns the lifecycle: it
pauses idle sandboxes and prunes ghost records. The tradeoff is that a sandbox outlives a
crashed backend; the worktree is on the host, and IdleSweeper prunes on next sweep. Note
a Kubernetes provider may *reject* a null timeout.

### J. `backend/src/services/OpenSandboxRouter.ts` **[DELETED]**

Unwired, self-documented as dead, and the origin of the `pullPolicy` / `cpuCount` /
`memoryMb` payload the engine copied. Removed so it stops being a reference.