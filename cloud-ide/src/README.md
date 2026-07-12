# Cloud IDE — setup

## ⚡ End to end, in order

Do these five in sequence. Each links to the section that explains it; if nothing goes
wrong you never need to read them.

| # | Step | Command |
|---|---|---|
| 1 | [Prerequisites](#prereqs) — Node x64, Docker | `node -p "process.arch"` → `x64` |
| 2 | [Where does Docker live?](#wsl) — **native `dockerd` in WSL ⇒ the whole stack runs inside WSL.** All-or-nothing | `docker info` |
| 3 | [Install](#install) — once, at the root. It's a monorepo | `npm install` |
| 4 | [**Check the host**](#doctor) — don't skip. Five seconds, and it rules out a whole class of build failure | `npm run doctor` |
| 5 | [Run](#run) — daemon + gateway + UI | `npm run dev` |

Then open the UI, create an environment, build it, and launch a sandbox.

> [!IMPORTANT]
> If a **build** fails on a package install (`pip`, `npm`, `cargo`, `go`), re-run
> `npm run doctor` before you suspect the pipeline. That failure is almost always
> [broken container DNS](#gotchas), and every package manager reports it in a different
> and misleading dialect.

---

<a id="prereqs"></a>
## 🛠️ System Prerequisites
Before installing, make sure your environment has:

*   **Node.js (v24.x 64-bit):** Run the x64 build. Verify with:
    ```bash
    node -p "process.arch"
    ```
*   **Docker Desktop (or native `dockerd` in WSL):** Required for the local OpenSandbox daemon.

> [!NOTE]
> **No Rust toolchain is needed to run the stack.** The gateway talks to the
> OpenSandbox daemon directly over HTTP; the `src-rust` napi engine is legacy and
> is no longer wired into the runtime (`dev`/`dev:backend` never build it). Only
> install rustup — plus the MSVC toolchain on Windows — if you are actively working
> on `src-rust` itself (`npm run build:rust -w backend`).

<a id="install"></a>
## 🚀 Installation

Because this is a monorepo, you only ever run `npm install` at the root. Do not navigate into the individual folders to install baseline packages.

```bash
# From the root /cloud-ide/src directory
npm install
```

**What this does:** NPM will parse all three `package.json` files, download all dependencies, hoist shared libraries to the root `node_modules` to save space, and automatically symlink the `@cloud-ide/shared` package into both the frontend and backend.

<a id="doctor"></a>
### Then check the host

```bash
npm run doctor          # five seconds
npm run doctor -- --fix # apply what it can (needs sudo)
```

Three host conditions break this stack in ways **no error message names**, so the app
cannot tell you about them honestly. `doctor` checks them: the Docker daemon is up,
containers can resolve hostnames, and buildx/BuildKit is present. Run it before you debug
a build — see [the DNS gotcha](#gotchas) for why the middle one matters far more than it
sounds.

<a id="run"></a>
## 🏃‍♂️ Running the Stack
You can boot the entire infrastructure (the OpenSandbox daemon, the Express Gateway, and the Vite frontend) with a single command:

```bash
# From the root directory
npm run dev
```

### Alternative Individual Commands:

*   `npm run dev:frontend` — Starts only the React UI.
*   `npm run dev:backend` — Starts the API Gateway (Express, via `ts-node`). No Rust build; the gateway reaches the OpenSandbox daemon over HTTP.

<a id="wsl"></a>
## 🐧 If Docker lives inside WSL (not Docker Desktop)

With native `dockerd` in a WSL2 distro there is no `docker.exe` on Windows and no
`D:\` → `/mnt/d` path translation. **The whole stack must then run inside WSL** — it
is all-or-nothing, not a preference:

- the OpenSandbox daemon reaches Docker over `unix:///var/run/docker.sock`;
- it bind-mounts worktrees into containers, and those host paths are resolved by
  `dockerd` *in WSL*, which cannot see `D:\...`;
- `FileSystemManager` is host-direct `node:fs` over those same worktrees.

Gateway, daemon and worktrees therefore share one filesystem. Splitting the gateway
onto Windows breaks bind mounts *and* leaves `DockerBuilder`/`GarbageCollector` with
no CLI to spawn.

```bash
# Inside the distro. Node 22, then a checkout on ext4 (NOT /mnt/*, see below).
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
git clone <repo> ~/cloud-ide && cd ~/cloud-ide/cloud-ide/src && npm install
npm run dev
```

No code changes are needed: every path derives from `process.cwd()` / `__dirname`,
so a checkout inside WSL wires `allowed_host_paths` and the worktrees root correctly.
Edit from Windows over `\\wsl.localhost\` or VS Code Remote-WSL.

> [!CAUTION]
> ### Keep the checkout on ext4 — inotify is dead on `/mnt/*`
> `/mnt/d` is a `v9fs` mount and **delivers no inotify events**. `WorkspaceWatchers`
> (chokidar) registers its watchers successfully, fires nothing, and the live file
> tree silently stops updating — no error anywhere. Bind mounts work from both
> filesystems; inotify is the only discriminator. `chokidar`'s `usePolling: true`
> works around it at a real CPU cost; an ext4 checkout doesn't need it.

<a id="gotchas"></a>
### Three gotchas that cost real time

- **Containers can't resolve hostnames ⇒ every package install fails, and none of them
  say "DNS".** Docker copies WSL's `/etc/resolv.conf` into every container. It points at
  WSL's Windows-side DNS proxy (e.g. `172.17.208.1`), which is **unreachable from a
  container's network namespace**. One cause, four dialects:

  | manager | what it prints |
  |---|---|
  | pip | `No matching distribution found` — reads like a *versioning* problem. It isn't |
  | npm | `EAI_AGAIN registry.npmjs.org` |
  | cargo | `Could not resolve host: index.crates.io` |
  | go | `dial tcp: lookup proxy.golang.org` |

  `npm run doctor` detects it. `npm run doctor -- --fix` writes the fix (it refuses to
  clobber an existing `daemon.json`). By hand:
  ```bash
  echo '{"dns": ["1.1.1.1", "8.8.8.8"]}' | sudo tee /etc/docker/daemon.json
  sudo service docker restart
  ```
  This **must** be daemon-level: `docker build` has no `--dns` flag, so BuildKit takes DNS
  from the daemon and nothing the app sets per-sandbox can reach the builder.

- **No systemd ⇒ `dockerd` has no supervisor.** The *inbox* WSL on Windows 10
  (`wsl.exe --version` → "Invalid command line option") ignores `[boot] systemd=true`
  in `/etc/wsl.conf`. `docker info` then fails after every restart and `boot.js` reports
  "Docker is not running". Start it by hand each session — `sudo service docker start` —
  or install the Microsoft Store WSL, which supports systemd.
- **An interrupted `uv pip install` poisons the uv cache.** Killing the install
  mid-extraction leaves truncated archives; later installs fail with
  `The wheel is invalid: Invalid Wheel-Version in WHEEL file: None` on an arbitrary
  small wheel. Fix with `uv cache clean`. (The venv half of this is handled — see
  `opensandbox/boot.js`.)

## 📦 Installing New Dependencies
To keep the monorepo clean, always use the `-w` (workspace) flag when installing new packages. This registers the package to the correct sub-folder while physically installing it at the root.

### Adding to the Frontend:

```bash
npm install date-fns -w frontend
npm install @types/date-fns -w frontend --save-dev
```

### Adding to the Backend:

```bash
npm install pg -w backend
```

### Adding to the Shared:
```bash
npm install zod -w shared
```

---

## 📚 Docs

Design records and per-area guides (this `src/` dir is the project root; `../` items
below live here alongside this README):

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, build phases, known debt. |
| [VFS.md](./VFS.md) | Virtual file system design. |
| [backend/README.md](./backend/README.md) | Gateway subsystems, env vars, running & tests. |
| [backend/TERMINAL_BACKEND.md](./backend/TERMINAL_BACKEND.md) | Terminal + sandbox-driver abstraction (PTY). |
| [backend/HEALTH.md](./backend/HEALTH.md) | Health-probe subsystem. |
| [backend/LSP.md](./backend/LSP.md) | Language-server (LSP) setup & proxy architecture. |
| [frontend/README.md](./frontend/README.md) · [frontend/src/pages/README.md](./frontend/src/pages/README.md) | Frontend stack; route views incl. the sandboxes control plane. |
| [frontend/src/editor/SECURITY.md](./frontend/src/editor/SECURITY.md) | Auth/CSRF/IDOR hardening (backend links here too). |
| [backend/src/services/builder/README.md](./backend/src/services/builder/README.md) | Image build pipeline — **and why a failed package install is usually DNS**. |

Feature areas keep their own `README.md` next to the code (drivers, builder, terminal,
vfs, env-manager, …).
