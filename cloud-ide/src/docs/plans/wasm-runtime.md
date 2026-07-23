# WASM sandbox runtime — scope

Status: **SCOPED, not approved, not built.** Written 2026-07-23.
Related: [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (the driver seam),
[`git-integration.md`](./git-integration.md), [`workspace-entity.md`](./workspace-entity.md).

## Goal

A **second deployment tier**, not a replacement: the same backend, the same API, the same
frontend, with sandbox execution swapped from Docker containers to WASM modules — so the
whole product can be deployed on a machine that costs ~nothing instead of one that can run
Docker, nftables and a 6.18 kernel.

The user-visible promise is *cheaper to host*, and the price is *a narrower set of things
that can run*. Both halves have to be stated honestly or this becomes a trap.

```
SANDBOX_DRIVER=opensandbox   full fidelity — any image, real PTY, native binaries
SANDBOX_DRIVER=wasm          curated runtimes, no PTY, no native binaries, tiny footprint
```

## What does NOT change

This is the important part, and it is most of the system. The WASM tier keeps:

- **Storage.** `WorktreeEngine`, git worktrees on the host, `sbx-<id>` branches, the whole
  "git IS our Merkle tree + WAL" model. WASI preopens hand a module a real host directory,
  so the mount story is a preopen instead of a bind — one line different, same directory.
- **The git surface.** Clone, commit, push, the Source Control pane, credentials. Host-side,
  PAT still server-side. No CORS proxy, unlike the browser tier.
- **Workspaces**, archive upload, `/api/fs`, `FsEventHub`, the VFS, the editor, LSP proxy,
  preview ingress, sessions, auth, the env-manager UI and its build/cache machinery.
- **Per-user package caches** (`cacheVolumes.ts`, `/cide-cache`) — installs stay warm across
  sandboxes exactly as they do now, because the filesystem is still the host's.

## What changes, and what is lost

| Capability | Docker tier | WASM tier |
|---|---|---|
| Arbitrary images / `apt` | yes | **no** — curated modules only |
| Native binaries, C extensions | yes | **no** |
| Interactive PTY (bash, job control) | yes | **no** — `pty: false`, line-mode exec |
| Interpreted package installs (npm/pip, pure) | yes | yes, once a runtime module hosts them |
| Dev server binding a port | yes | **not in phase 1** (needs wasi-sockets) |
| Egress policy / nftables / kernel 6.18 | required | **not applicable** — capability-based |
| Idle footprint | hundreds of MB | single-digit MB |
| Boot | seconds | milliseconds |

**The egress subsystem simply does not apply.** WASI is capability-based: a module has no
filesystem, clock, or network beyond what the host hands it. "No network" is the default,
not a firewall rule. That deletes the largest ops dependency in the current stack.

## The driver surface, method by method

`ISandboxDriver` is the only seam that has to change. Per method, concretely:

| Member | Plan |
|---|---|
| `bootSandbox(spec)` | Instantiate the module set for `spec.imageTag`; preopen the worktree host path at `/workspace`. Register in an in-process map. Return a synthetic `SandboxStatus`. |
| `getSandboxStatus` / `destroySandbox` | Map lookup / dispose. Trivial. |
| `pauseSandbox` / `resumeSandbox` | Phase 1: no-ops returning `true`. A wasm instance is cheap enough that scale-to-zero can mean "drop it". |
| `execCommand` | Instantiate a module with argv, capture stdio, return buffered result. |
| `resolveExecConnection` | **See below — the one real friction point.** |
| `resolveEndpoint(id, port)` | Phase 1: reject (nothing listens). Phase 2 with wasi-sockets: the host owns the real socket, so return `http://127.0.0.1:<hostPort>` and preview ingress works unchanged. |
| `capabilities()` | `{ exec: true, pty: false }`. |
| `openSession?` | **Omitted.** Absent ⇒ exec-only, which the transport factory already handles. |
| `openExecStream?` | Instantiate a module with stdin/stdout wired to a `Duplex`. Natural fit — this is how a wasm module's stdio works anyway. Gates in-sandbox LSP. |

### The one real friction point: `resolveExecConnection`

`SandboxController.ts:291` does not go through the driver to stream exec. It calls
`resolveExecConnection()` for a `baseUrl`, then `fetch`es `${baseUrl}/command` directly and
streams the response. An in-process wasm module has no URL.

Two options:

1. **Loopback execd shim (recommended).** The backend hosts one small internal HTTP listener
   that speaks execd's wire protocol, keyed by sandbox id. `resolveExecConnection` returns
   `http://127.0.0.1:<shimPort>/<id>`. **Nothing outside the driver changes.**
2. Refactor `SandboxController` to stream through the driver. Cleaner long-term, but it
   edits a working path to enable an experiment. Not for a spike.

⚠️ **The shim must speak newline-delimited bare JSON, not SSE**, despite the controller
sending `Accept: text/event-stream`. See the sandbox-boot-contract note — execd's actual
wire format is bare JSON lines. Getting this wrong is a silent day of debugging.

## Runtime choice — spike with stdlib

**Phase 1 uses `node:wasi`, which is built into Node.** It gives preopens, argv, env and
stdio, which is the entire phase-1 requirement. **No dependency at all.** It is preview1
only — no sockets, no threads, one module per instance — and those limits are exactly the
phase-1 boundary anyway.

Graduate only when a limit actually bites:

- **wasmtime** — sockets (wasi-sockets/preview 2), better performance, memory64. Buys
  `resolveEndpoint`, i.e. preview.
- **Wasmer + WASIX** — adds `fork`/`exec`/threads/signals, and a real bash. **The only
  honest route to `pty: true`.** Cost: everything recompiled against WASIX, and lock-in to
  one runtime. Decide this only after using `pty: false` in anger.

## Installation and custom environments

The env-manager does **not** die; its Docker *builder* stops applying. `IBuilder` +
`BuilderRegistry` + `IBuildStore` already exist for multiple build backends, so a WASM
environment is a new `IBuilder` that resolves a manifest to a **set of modules** and caches
it like image layers.

- **Interpreted packages persist normally.** `npm install` (pure JS) and `pip install`
  (pure-Python or prebuilt wheels) write into the worktree or `/cide-cache` — the host
  filesystem — so they survive exactly as today.
- **Native anything is out.** No engineering closes this short of emulation.

"Custom environment" therefore means *curated base + resolvable packages*, not *any
Dockerfile*. That is the honest promise to put in the UI.

## Acceptance criteria for the spike

Falsifiable, and each one kills the idea if it fails:

1. **Files are shared.** A guest writes `/workspace/out.txt`; the host VFS lists and reads it
   without a special case. (Proves preopen ↔ worktree.)
2. **Output streams.** `execCommand` output arrives incrementally, not buffered to the end.
3. **Boot is genuinely cheap.** Instantiate-to-first-output well under 100 ms.
4. **Idle footprint** per sandbox in single-digit MB.
5. **A real program runs** against a real checkout — a Python script over the workspace
   files, not a hello-world.
6. **Teardown leaks nothing** — no fd, memory, or map entry after destroy.
7. **The Docker tier is untouched** — full suite green with `SANDBOX_DRIVER` unset.

## Phases

1. **Spike** — `WasmDriver` on `node:wasi`, `pty: false`, `resolveEndpoint` rejecting, the
   loopback execd shim, one prebuilt runtime module (CPython-wasm is the safest first
   choice). Wire into `createSandboxDriver()` behind `SANDBOX_DRIVER=wasm`. Answers the
   acceptance criteria above.
2. **A usable runtime tier** — the WASM `IBuilder`, a curated module registry, package
   installs into the cache volume.
3. **Sockets** — move to wasmtime, implement `resolveEndpoint`, preview works.
4. **PTY** — only if `pty: false` proves intolerable, and only via WASIX, accepting the
   runtime commitment.

## WASIX spike — RESULT (2026-07-23)

Run against **wasmer 7.2.1 in WSL** (kernel 6.18), before committing to WASIX. The question
was: does WASIX give us the process model, and does it get us `npm install`?

**Works — the process model is real:**

| Probe | Result |
|---|---|
| `wasmer/bash` runs | ✅ |
| Command substitution `$(…)` — needs **fork** | ✅ `got:nested` |
| Pipeline `echo … \| tr` — needs **fork + exec of another binary** | ✅ `one two three` |
| `&&` chaining, `cd`, `>` redirection | ✅ |
| `wasmer/python` | ✅ `print(6*7)` → 42 |
| `wasmer/coreutils` | ✅ |
| **Host directory mount** (`--volume`, was `--mapdir`) | ✅ guest wrote `output.txt`; **the host sees it** |

That last row matters: the preopen/mount storage model survives a move to Wasmer, so
worktrees keep working exactly as they do on `node:wasi`.

**Does NOT work — and this is the decisive finding:**

| Probe | Result |
|---|---|
| `wasmer/node` | ❌ **not in the registry at all** |
| `deno` | ❌ nothing |
| `pip` inside `wasmer/python` | ❌ `No module named pip` |

**There is no package manager on WASIX.** No Node means no `npm install`; no pip means no
Python installs either.

⚠️ **A stale package nearly produced the wrong conclusion.** `sharrattj/bash` (1.0.18)
crashes on wasmer 7.2.1 with `RuntimeError: indirect call type mismatch` — which looks
exactly like "fork is unsupported". The current `wasmer/bash` (1.0.25) works fine. Always
check package recency against the runtime before concluding a capability is missing.

### What this changes

An earlier note in this plan claimed a shell and custom installs were the same requirement,
both blocked by `fork`/`exec`. **That was half right.** fork/exec is necessary but not
sufficient: the blocker for environments is the **package ecosystem**, and no runtime
choice fixes that. Concretely:

- **WASIX buys a terminal** — a real shell, real pipelines, and therefore a credible route
  to `pty: true`. (Interactive TTY itself is still unproven: the spike ran `bash -c`, not an
  attached terminal.)
- **WASIX does not buy an env builder.** "Custom install environments" is not reachable on
  WASM under any runtime today. That capability belongs to the Docker tier, full stop.

So the WASM tier's honest promise is **"edit and run curated-language projects, with a
shell"** — not "build arbitrary environments". The env-manager redesign should say exactly
that rather than imply parity.

### Can the terminal architecture port to Wasmer? Yes — and most of it does not move

Probed directly, and the answer is structural: **the PTY already comes from the host, not
from Docker.** `DockerPtyDriver`'s own comment says it — "node-pty gives docker a real host
PTY so `-t` succeeds". Docker is not the terminal; node-pty is, and Docker merely inherits
it. Wasmer would inherit it the same way.

| Layer | Port cost |
|---|---|
| xterm.js frontend | **none** |
| Terminal transport factory (capability negotiation) | **none** |
| WS `/pty` bridge | **none** |
| `ISandboxSession` (`onData`/`onExit`/`write`/`resize`/`close`) | **none** — already runtime-neutral, pure bytes + resize |
| node-pty → `ISandboxSession` adapter | **none** — wraps `IPty` generically |
| The driver's **argv** | ← the only real change |

```
pty.spawn('docker', ['exec', '-it', container, shell])
pty.spawn('wasmer', ['run', 'wasmer/bash', '--volume', `${worktree}:/workspace`, '--', '-i'])
```

Since that is the sole difference, the lazy shape is not a second driver but generalising
`DockerPtyDriver` into a host-PTY driver parameterised by an argv builder.

**Verified by probe:**

- Interactive bash with a real prompt (`bash-dist#`), driven by writing lines to stdin and
  reading stdout — exactly the `ISandboxSession` contract.
- Workspace mounted, read **and written**, with the host seeing the new file immediately.
- **Warm start 0.10s** (cold 4.7s, which is wasmer compiling bash; it caches per package,
  so pre-warm the cache at deploy rather than per sandbox).

**Not yet verified — the remaining risk, and it is exactly what `resize()` and Ctrl-C need:**

- SIGWINCH / resize propagation into the guest.
- Ctrl-C → SIGINT delivery.
- Line editing (arrows, history) through a genuine PTY — the probe drove it over pipes.

⚠️ Syntax trap: `--volume` takes **HOST:GUEST** (Docker order); the deprecated `--mapdir`
takes **GUEST:HOST**. Getting it backwards fails, and under `-i` with stderr suppressed it
fails *silently*.

### Recommendation

**Still: phase 2 before WASIX** — but on a corrected basis. The port cost is far lower than
first assumed (one argv, not a rewrite), so the case against is no longer "expensive". It is
that WASIX buys a **terminal** while the tier's real gap is the **package ecosystem**, which
no runtime fixes. A great shell that cannot `npm install` is still a curated-runtime tier.

So: build phase 2 (the WASM `IBuilder` and a curated module set) first, because it addresses
the actual gap. Take WASIX the moment the terminal becomes the blocking complaint in real
use — it is a cheap, well-understood change whenever you want it, and it forecloses nothing.

Revisit when either the terminal becomes the blocking complaint in real use, or a Node
build for WASIX appears.

## Package ecosystem — RESEARCHED + VERIFIED (2026-07-23)

### Correction: Node-in-WASM exists

The WASIX spike above concluded "no Node, therefore no npm, on any WASM runtime". **That was
wrong** — it searched for `wasmer/node`, which does not exist, and stopped there. The
package is **`wasmer/edgejs-quickjs`**, and it reports `v24.13.2`:

```
$ wasmer run wasmer/edgejs-quickjs -- --version   →  v24.13.2-pre
```

[Edge.js](https://wasmer.io/posts/edgejs-safe-nodejs-using-wasm-sandbox) is a real Node
runtime in a Wasm sandbox — built on Node's own dependencies (libuv, llhttp, ada, ncrypto),
claiming 3,592/3,626 core Node tests passing and 30% slowdown when fully sandboxed.
Verified here: `node:fs` and `node:path` work, files written by the guest appear on the
host. It is **pre-1.0**.

### The working answer: resolve on the HOST, execute in the GUEST

Both ecosystems work today, and the mechanism is the same for each — because the backend is
already Node, already on a real OS with network, and the worktree is already a host
directory that gets mounted into the sandbox.

**JavaScript — verified end to end:**
```
host $  npm install lodash.chunk            # real npm, into the worktree's node_modules
guest$  wasmer run wasmer/edgejs-quickjs --volume=$WORKTREE:/app -- /app/index.js
        →  NPM_PKG_OK [[1,2],[3,4]]
```

**Python — verified end to end.** The flags are the whole trick: they force pip to take only
pure-Python wheels and never execute a build step.
```
host $  pip3 install --target=$W/libs --only-binary=:all: \
          --implementation py --python-version 3.12 --abi none --platform any toml
guest$  wasmer run wasmer/python --volume=$W:/app -- /app/t.py
        →  PY_PKG_OK {'a': 1}
```

This is elegant *because it changes nothing structurally*. Installing is build-time work on
the host — which is what `IBuilder` already is — and the per-user cache volume
(`cacheVolumes.ts`, `/cide-cache`) already persists exactly this kind of artifact between
sandboxes. The guest never needs a package manager, a network stack, or a compiler.

### In-guest `npm install` — runs, but blocked by a bug

Worth knowing, because it is *nearly* there. npm itself executes inside the sandbox:

```
$ wasmer run wasmer/edgejs-quickjs --volume=/usr/lib/node_modules/npm:/npm \
    --env HOME=/app/home --net -- /npm/bin/npm-cli.js --version   →  10.9.8
```

`npm install` then fails with `cannot set sizeCalculation without setting maxSize`. Root
cause found: **`os.totalmem()` returns 4 MiB** in the guest, so npm's cache layer computes a
nonsense memory budget and its lru-cache constructor throws. That is an Edge.js bug, not a
WASM limit — if it is fixed upstream, in-guest installs become possible and the host/guest
split below becomes an optimisation rather than a requirement.

(`HOME` must be set, or npm dies earlier still on `uv_os_homedir returned ENOENT`.)

### The permanent limit: why native bindings cannot load

A "native module" (`.node` for Node, `.so` for a Python C extension) is **compiled machine
code** for one CPU architecture and OS ABI — x86-64 ELF, arm64 Mach-O. A wasm guest has no
CPU to run that on: the VM executes wasm bytecode and nothing else. Loading one is not
forbidden, it is *meaningless* — there is no instruction decoder for it. Three further walls
sit behind that one: WASI preview1 has no `dlopen`; wasm modules have separate linear
memories, so N-API's pointer-passing C ABI has nothing to point into; and addons routinely
need threads, `mmap` and `ioctl` that WASI does not expose.

**Verified, and the result is instructive.** Installing `bufferutil` (a native addon) on the
host and requiring it in the guest *appears to work* — but a `process.dlopen` hook proves no
library is ever loaded:

```
platform: wasi   arch: unknown   execPath: /bin/edge
(DLOPEN never called)
loaded, mask is function
mask RAN ok: [0,3,2,5]        ← correct XOR masking, from the package's JS fallback
```

The prebuilds on disk are `linux-x64`, `darwin-arm64`, `win32-ia32`. The guest reports
`arch: unknown`, so `node-gyp-build` matches none of them and `bufferutil` silently falls
back to its **pure-JS implementation**. So:

- Packages with a JS fallback (`bufferutil`, `ws`, many others) **degrade gracefully and work**.
- Packages without one **hard-fail at require time**.

**The exception that proves the rule:** `import sqlite3` in `wasmer/python` works
(`SQLITE_OK 3.43.0`) — not because a `.so` was loaded, but because CPython's WASI build
**statically compiles sqlite into the interpreter**. That is the only route to native
functionality: someone recompiles the library to wasm and links it *into the runtime
distribution*. Pyodide does this for ~250 packages. It is a per-package, per-runtime
effort — never dynamic, never automatic.

So the reachable ecosystem is: **pure-source packages, plus whatever was pre-compiled into
the runtime you chose.** That belongs in the UI, not at import time.

## Multiple languages in one environment

**Naturally supported — arguably better than Docker.** A WASM environment is a *directory of
modules*, and `WasmDriver` already resolves `command[0]` → `<modulesDir>/<program>.wasm`.
Drop `python.wasm` and `edge.wasm` in the same directory and one sandbox runs both, over one
shared worktree. No combined base image to build.

A Django + React environment is therefore:

| Need | Status |
|---|---|
| Django itself | ✅ pure Python — host `pip --target`, verified |
| `sqlite3` for the ORM | ✅ statically linked into the WASI CPython build |
| React / Vite deps | ✅ pure JS — host `npm install`, verified |
| `python manage.py …` | ✅ resolves to `python.wasm` |
| `node …` / bundler | ✅ resolves to `edge.wasm` |
| **`runserver` on :8000, Vite on :5173** | ❌ **needs sockets** |

**This changes the runtime priority.** Both halves of that stack are servers, and WASI
preview1 cannot `listen()`. So for the use case people actually want, **sockets matter more
than a PTY** — which moves wasmer/WASIX up the roadmap ahead of the terminal work, and ahead
of where the WASIX spike placed it. See below: the blocker turns out to be removable.

## "Needs sockets" — what it means, and the workarounds

Preview1 has `sock_recv`/`sock_send`/`sock_accept` but **no `socket`, `bind` or `listen`**. A
guest cannot *create* a listener. It can still serve, three different ways:

**1. Host pre-opens the listener (works on preview1 today).**
`wasmtime run --tcplisten 127.0.0.1:6000 server.wasm` — the *host* binds and listens, and
hands the guest a raw fd it can `sock_accept()` on. This is systemd socket activation.
Trade-off: the application must accept an **inherited fd** rather than binding its own.
Fine for Rust/Go with `listenfd`; Django's `runserver` and Vite both bind their own, so
they would need a shim.

**2. WASIX (wasmer) — full BSD sockets, apps unmodified. ✅ VERIFIED.**
A stock Node HTTP server, no changes at all:
```js
http.createServer(...).listen(8111, "0.0.0.0")     // inside the guest
```
```
$ wasmer run wasmer/edgejs-quickjs --volume=$W:/app --net -- /app/srv.js
  → LISTENING on 8111
$ curl http://127.0.0.1:8111/     (from the HOST)
  → SERVED_FROM_WASM
```
`bind`/`listen` worked untouched and the host reached it. **This removes the blocker
entirely** — `runserver` and Vite need no shim, and `resolveEndpoint()` becomes trivial.

**3. WASI preview 2 `wasi-sockets`** — the standardised version of the same thing, via the
component model. The portable long-term answer; wasmtime's path.

### Consequence for the runtime choice

`node:wasi` was right for phase 1 — zero dependencies, and it proved the storage model and
the driver seam. **But wasmer/WASIX is the production target**, and now on evidence rather
than preference. Verified across this and earlier probes: sockets, Node v24 (`edgejs`),
real bash with fork/exec, host directory mounts, 0.10s warm start.

## Escape hatch: running arbitrary native binaries under emulation

If an environment genuinely needs native code, there is a way — at a price.
[container2wasm](https://github.com/container2wasm/container2wasm) converts a **container
image** to wasm by shipping an emulated CPU: **Bochs** for x86_64, **TinyEMU** for riscv64,
with QEMU as an alternative. A whole Linux kernel and userland run inside the wasm sandbox,
so *any* binary works — including native modules, `apt`, compilers.

The cost is emulation: an interpreted CPU inside a VM, so orders of magnitude slower than
the direct path, and a much larger image. That makes it a deliberate third tier, not a
default. (CheerpX/WebVM does the same with an x86 JIT, but is proprietary.)

**Three tiers of fidelity, then:**

| Tier | Speed | Runs |
|---|---|---|
| WASM direct (`node:wasi`, wasmer) | near-native | pure-source packages, curated runtimes |
| container2wasm | slow (emulated CPU) | anything, including native modules |
| Docker | native | anything |

## The build pipeline — Docker-like functionality, WASM artifacts

A Docker image is *base OS + runtimes + installed packages*. The WASM equivalent is a
**directory**, and it drops onto the seams that already exist (`IBuilder`,
`BuilderRegistry`, `IBuildStore`) with no new architecture:

```
<buildStore>/<contentHash>/
  modules/     python.wasm, edge.wasm, bash.wasm, coreutils.wasm   ← the "base image"
  deps/
    node_modules/                                                  ← host-resolved
    pylibs/                                                        ← host-resolved
  manifest.json                                                    ← runtimes + lockfile hashes
```

**Build (host-side, cached):** fetch the runtime modules → run `npm install` /
`pip install --target` into `deps/` → write the manifest. **Launch:** mount the worktree at
`/workspace`, mount `modules/` and `deps/` read-only, set `NODE_PATH`/`PYTHONPATH`. The
cache key is `hash(runtime versions + lockfiles)`, giving Docker's "rebuild only when the
definition changed" property for free.

The environment definition becomes **declarative** rather than imperative — `runtimes: [node@24, python@3.12]`, `packages: {npm: [...], pip: [...]}` instead of `FROM`/`RUN`. That is
not a limitation to apologise for; see the next paragraph for why arbitrary `RUN` is
actively unsafe here.

### ⚠️ Host-side installs execute untrusted code ON THE SERVER

This is the one genuinely dangerous part of the host-resolution approach, and it has no
equivalent in the Docker tier, where the build is isolated inside a container.

`npm install` runs `postinstall` scripts **as the build user, on your host**, with your
filesystem and network. In a multi-tenant deployment that is arbitrary remote code
execution by anyone who can define an environment. Non-negotiable mitigations:

- **`npm install --ignore-scripts` by default.** Most pure-JS packages need no lifecycle
  script, and this is the difference between "resolve a dependency graph" and "run a
  stranger's shell script".
- **`pip install --only-binary=:all:`** already prevents execution — no `setup.py` runs when
  only wheels are permitted. Keep it, and never relax it to allow sdists.
- Treat the whole build as untrusted input: timeouts, disk quota, and no ambient
  credentials in the build environment.

The *right* long-term fix is to run the install inside the sandbox itself — blocked today
only by the Edge.js `os.totalmem()` bug documented above. When that lands, in-guest
installation removes this entire class of risk.

## Hosting: what is actually free, and what it costs architecturally

| Option | Free? | Fit |
|---|---|---|
| **Cloudflare Pages/Workers** | yes | ✅ frontend, and a git CORS proxy if ever needed |
| **Cloudflare Durable Objects** | yes — 100k req/day, 5 GB SQLite | ❌ no filesystem; worktrees need one |
| **Cloudflare Containers** | **no — Workers Paid $5/mo** | ❌ and explicitly not for persistent disks |
| **Vercel Sandbox** | yes — 5 CPU-hours/mo, 10 concurrent, **45 min max session** | ⚠️ Firecracker microVMs, real isolation, but **ephemeral** |
| **Oracle Cloud Always Free** | yes — persistent ARM VM, real disk | ✅ backend + worktrees + the WASM tier in-process |

**The shape that works:** frontend on Cloudflare Pages (free); backend, worktrees and the
WASM tier on one persistent free VM (the WASM tier costs no extra infrastructure — it runs
*inside* the backend process); Vercel Sandbox as a burst "full fidelity" tier for
environments that need native code.

### The catch nobody mentions: remote sandboxes break the bind mount

Every option above except the persistent VM is **ephemeral and elsewhere**. Today
`provision()` returns a host path that is bind-mounted, which requires the sandbox to be on
the same machine as the worktree. A Vercel Sandbox cannot mount your disk.

The fix is already in the architecture: **git is the transport.** The worktree stays on the
backend, the remote sandbox `cloneInto`s the `sbx-<id>` branch at boot, and commits push
back — which is exactly the "git IS our Merkle tree + WAL" philosophy extended one hop.

The open design question is *authority over the files*: today the editor writes through
`/api/fs` to the host worktree and the bind mount makes it instantly visible. With a remote
sandbox, edits are not visible until synced. Either the backend worktree stays
authoritative and the diff is pushed before each run, or the sandbox becomes authoritative
and `/api/fs` proxies to it. That decision should be made deliberately before any remote
driver is written — it is a bigger change than the driver itself.

## Explicitly out of scope

- Replacing the Docker tier. It stays the full-fidelity option.
- The browser-only tier. It shares the *toolchain* work (which is the expensive part) but
  needs a different storage layer (OPFS + isomorphic-git), a service-worker preview, and it
  moves the PAT into the tab. Doing wasmtime first is what de-risks it.
- Serverless hosting. A sandbox is stateful and long-lived; functions are neither. The free
  tiers that fit give you a *machine* (e.g. Oracle Always Free), not a function.

## The real risk

**The runtime is a day; the toolchain is the project.** Getting `node:wasi` to run a module
against the worktree is easy and phase 1 will feel like a success. Assembling language
environments people actually want, out of modules that exist and packages that resolve, is
where this is won or lost. Phase 1 exists to reach that question quickly and cheaply — not
to prove that WASM runs.
