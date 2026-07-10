# Prerequisites

## 🛠️ System Prerequisites
Before installing, ensure your development environment meets the strict architectural requirements for the Native FFI (Foreign Function Interface) engine:

*   **Node.js (v24.x 64-bit):** You must be running the x64 architecture of Node.js. 32-bit (ia32) will fail to bind to the Rust binaries. Verify with:
    ```bash
    node -p "process.arch"
    ```
*   **Rust Toolchain:** Install Rust via [rustup](https://rustup.rs).
*   **Microsoft C++ Build Tools (Windows Only):** The Rust compiler must use the MSVC toolchain to successfully inject the N-API Node.js handshake.
    *   **Run:** `rustup default stable-x86_64-pc-windows-msvc`
*   **Docker Desktop:** Required for the local OpenSandbox daemon.

## 🚀 Installation

Because this is a monorepo, you only ever run `npm install` at the root. Do not navigate into the individual folders to install baseline packages.

```bash
# From the root /cloud-ide/src directory
npm install
```

**What this does:** NPM will parse all three `package.json` files, download all dependencies, hoist shared libraries to the root `node_modules` to save space, and automatically symlink the `@cloud-ide/shared` package into both the frontend and backend.

## 🏃‍♂️ Running the Stack
You can boot the entire infrastructure (compiling the Rust engine, starting the Express Gateway, and launching the Vite frontend) with a single command:

```bash
# From the root directory
npm run dev
```

### Alternative Individual Commands:

*   `npm run dev:frontend` — Starts only the React UI.
*   `npm run dev:backend` — Cleans, rebuilds the Rust engine, and starts the API Gateway.

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

### Two gotchas that cost real time

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
