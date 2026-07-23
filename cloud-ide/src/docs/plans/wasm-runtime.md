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
