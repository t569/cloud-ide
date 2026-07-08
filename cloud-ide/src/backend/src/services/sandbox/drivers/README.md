# Sandbox Drivers

The **provider seam** for the whole sandbox layer. `SandboxManager` depends only on
`ISandboxDriver` — so swapping the sandbox provider (or adding a capability like an
interactive PTY) is a new driver, not a rewrite, and vendor/FFI types never leak past
a driver file.

## The interface — `ISandboxDriver.ts`
One implementation per provider. Methods:

- **Lifecycle:** `bootSandbox` · `getSandboxStatus` · `pauseSandbox` · `resumeSandbox` · `destroySandbox`
- **Exec (line-mode):** `execCommand` · `resolveExecConnection` · `getSandboxIp`
- **`capabilities()` → `{ exec, pty }`** — what this driver can do. Read by the terminal
  layer to pick a PTY vs line-mode transport.
- **`openSession?(id, opts)` → `ISandboxSession`** — *optional* interactive PTY. Absent ⇒
  the driver is exec-only. `ISandboxSession` is a raw byte stream (`onData`/`write`/
  `resize`/`onExit`/`close`) that `PtyGateway` bridges to a browser WebSocket.

## Implementations
| Driver | File | capabilities | Notes |
|---|---|---|---|
| **RustEngineClient** | `../rustClient.ts` | `{exec:true, pty:false}` | Default. OpenSandbox via the Rust kernel (`index.node`). Kept in `rustClient.ts` because it resolves the FFI binary relative to `__dirname` — do **not** move/rename the file. |
| **AlibabaSdkDriver** | `AlibabaSdkDriver.ts` | `{exec, pty:true}` | ⚠️ **Unverified scaffold.** Composition over the Rust driver (only `openSession` is the SDK's job). Adds the interactive PTY. Needs the SDK + live validation — see [`../../../TERMINAL_BACKEND.md`](../../../TERMINAL_BACKEND.md) step 5. |

## Selection — `createSandboxDriver()`
Reads `SANDBOX_DRIVER` (default `opensandbox`), mirroring the `DOCKER_BUILDER` pattern.
`opensandbox` → `RustEngineClient`; `alibaba` → `AlibabaSdkDriver` composed over it. Wired
in `server.ts` and injected into `SandboxManager`.

## Adding a provider
1. Implement `ISandboxDriver` in a new file here; keep the vendor SDK import inside it.
2. Return honest `capabilities()`; implement `openSession` only if you truly offer a PTY.
3. Add a branch to `createSandboxDriver()` + a `SANDBOX_DRIVER` value + a line in the table above.

Interactive-terminal wiring (PtyGateway, the WS protocol, the frontend transport factory)
lives in **[`../../../TERMINAL_BACKEND.md`](../../../TERMINAL_BACKEND.md)**.
