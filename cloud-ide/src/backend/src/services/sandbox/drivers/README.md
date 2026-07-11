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
| **AlibabaSdkDriver** | `AlibabaSdkDriver.ts` | `{exec, pty:true}` | ⚠️ **Unverified scaffold.** Same composition shape, but the PTY comes from the OpenSandbox SDK instead of docker-exec. Needs the SDK + live validation — see [`../../../TERMINAL_BACKEND.md`](../../../TERMINAL_BACKEND.md) step 5. |

## Selection — `createSandboxDriver()`
Reads `SANDBOX_DRIVER` (default `opensandbox`), mirroring the `DOCKER_BUILDER` pattern.
Default → `DockerPtyDriver` composed over `RustEngineClient`; `alibaba` → `AlibabaSdkDriver`
composed over it. Wired in `server.ts` and injected into `SandboxManager`.

## Adding a provider
1. Implement `ISandboxDriver` in a new file here; keep the vendor SDK import inside it.
2. Return honest `capabilities()`; implement `openSession` only if you truly offer a PTY.
3. Add a branch to `createSandboxDriver()` + a `SANDBOX_DRIVER` value + a line in the table above.

Interactive-terminal wiring (PtyGateway, the WS protocol, the frontend transport factory)
lives in **[`../../../TERMINAL_BACKEND.md`](../../../TERMINAL_BACKEND.md)**.
