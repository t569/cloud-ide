# Sandbox Drivers

The **provider seam** for the whole sandbox layer. `SandboxManager` depends only on
`ISandboxDriver` — so swapping the sandbox provider (or adding a capability like an
interactive PTY) is a new driver, not a rewrite, and vendor/FFI types never leak past
a driver file.

## The interface — `ISandboxDriver.ts`
One implementation per provider. Methods:

- **Lifecycle:** `bootSandbox` · `getSandboxStatus` · `pauseSandbox` · `resumeSandbox` · `destroySandbox`
- **Exec (line-mode):** `execCommand` · `resolveExecConnection` · `resolveEndpoint`
- **`capabilities()` → `{ exec, pty }`** — what this driver can do. Read by the terminal
  layer to pick a PTY vs line-mode transport.
- **`openSession?(id, opts)` → `ISandboxSession`** — *optional* interactive PTY. Absent ⇒
  the driver is exec-only. `ISandboxSession` is a raw byte stream (`onData`/`write`/
  `resize`/`onExit`/`close`) that `PtyGateway` bridges to a browser WebSocket.

## Implementations
| Driver | File | capabilities | Notes |
|---|---|---|---|
| **RustEngineClient** | `../rustClient.ts` | `{exec:true, pty:false}` | The base OpenSandbox driver: lifecycle + line-mode exec via `openSandboxEngine.ts` (a pure-TS HTTP client). Name kept for continuity — there is **no** Rust/FFI anymore. |
| **DockerPtyDriver** | `DockerPtyDriver.ts` | `{exec, pty:true*}` | **Default.** Composition over the base: lifecycle/exec delegate; adds interactive PTY via `docker exec -it sandbox-<id>` (node-pty). `*pty` is true only if node-pty loaded, so it self-downgrades to exec-only where it isn't built. |
| **AlibabaSdkDriver** | `AlibabaSdkDriver.ts` | `{exec, pty:true}` | ⚠️ **Unverified scaffold.** Same composition shape, but the PTY comes from the OpenSandbox SDK instead of docker-exec. Needs the SDK + live validation — see [`../../../../TERMINAL_BACKEND.md`](../../../../TERMINAL_BACKEND.md) step 5. |
| **WasmDriver** | `wasm/WasmDriver.ts` | `{exec:true, pty:false}` | The **cheap deployment tier**: WASM modules instead of containers, so the product runs where there is no Docker daemon at all. Standalone, **not** composed over the base — it replaces the runtime, and there is no daemon to talk to. Runs on `node:wasi`, which is built in, so this tier adds **no dependency**. See [`docs/plans/wasm-runtime.md`](../../../../docs/plans/wasm-runtime.md). |

### Notes on `WasmDriver`
- **Storage does not move.** WASI *preopens* hand a module a real host directory, so a
  sandbox's git worktree is mounted by naming it rather than bind-mounting it —
  `WorktreeEngine`, the git surface and `/api/fs` all keep working.
- **`pty: false` is the truth, not a stub.** WASI preview1 has no `fork`/`exec`, so there is
  no shell to attach a TTY to; the transport factory falls back to line-mode on that flag.
- **`resolveEndpoint` throws** — preview1 has no sockets, so nothing can listen. This is the
  one capability moving to wasmtime buys.
- **`wasmExecdShim.ts`** serves the one endpoint `SandboxController` fetches directly
  (it takes `resolveExecConnection().baseUrl` and calls it itself rather than going through
  the driver). Loopback-only, ephemeral port, per-process token. ⚠️ It emits **raw JSON
  objects one per line, not SSE**, despite the `text/event-stream` content-type — the real
  parser is the frontend's `SseExecTransport`, and real SSE renders a blank terminal.
- **Resource limits are enforced here, not by the runtime.** One child per exec, so the
  parent caps wall-clock and output bytes (both portable), and `ulimit -v` caps address
  space on POSIX. Two of those protect the *gateway*: `execCommand` buffers output in
  memory, and four bytes of wasm (`loop { br 0 }`) hangs forever.

## Selection — `createSandboxDriver()`
Reads `SANDBOX_DRIVER` (default `opensandbox`), mirroring the `DOCKER_BUILDER` pattern.
Default → `DockerPtyDriver` composed over `RustEngineClient`; `alibaba` → `AlibabaSdkDriver`
composed over it; `wasm` → `WasmDriver` alone. Wired in `server.ts` and injected into
`SandboxManager`.

## Adding a provider
1. Implement `ISandboxDriver` in a new file here; keep the vendor SDK import inside it.
2. Return honest `capabilities()`; implement `openSession` only if you truly offer a PTY.
3. Add a branch to `createSandboxDriver()` + a `SANDBOX_DRIVER` value + a line in the table above.

Interactive-terminal wiring (PtyGateway, the WS protocol, the frontend transport factory)
lives in **[`../../../../TERMINAL_BACKEND.md`](../../../../TERMINAL_BACKEND.md)**.
