# Terminal Backend & Sandbox-Driver Abstraction — Implementation Guide

Status: **planning doc**, not yet built. This is the roadmap for two linked
pieces of work:

1. A **real interactive terminal** (PTY) to replace today's line-mode exec.
2. A **provider-neutral sandbox driver** so OpenSandbox (Alibaba SDK) is *one*
   interchangeable backend, not the foundation everything is welded to.

The guiding rule (see root `ARCHITECTURE.md`): **depend on our own port, not a
vendor SDK.** We build the interactive terminal against *our* interface, then
plug OpenSandbox in behind it — the same way any future sandbox provider would.

---

## 1. Where we are today (the honest baseline)

**Live path — line-mode command streaming (wired, in production):**

```
xterm ─ SseExecTransport ─POST /api/v1/sandboxes/:id/exec─ SandboxController.execCommand
        (frontend)                                          │
                                                            ├─ resolveExecConnection (Rust → execd proxy URL + token)
                                                            └─ fetch <proxy>/command (SSE) ──▶ piped to browser
```

- `SseExecTransport` (`frontend/terminal/transport/`) — local echo, buffers a
  line, POSTs `['/bin/sh','-c', line]` on Enter, streams stdout/stderr back.
- `SandboxController.execCommand` — wake-on-demand resume, then pipes the Go
  `execd` `/command` SSE stream straight to the response.
- `IDETerminal` now uses `SseExecTransport` (was a mock).

**What it CANNOT do, by construction:**
- No PTY → no interactive programs (vim, top, less, REPLs).
- **No persistent shell** — every Enter is a fresh `sh -c`, so `cd`, exported
  env, and shell history do not carry between commands.

**Assets already in place we will reuse:**
- `ITransportStream` (`frontend/terminal/types/terminal.ts`) — the frontend
  **port**. `Terminal.tsx` speaks only to this; swapping transports is a factory
  choice, no UI change. This is the hexagonal seam that makes everything below
  cheap.
- `WebSocketTransport` — already written (binary frames, resize, backoff
  reconnect). It has **no backend endpoint yet** — that's Phase 2.
- `SessionStream` — a browser-direct Alibaba-SDK transport that runs a real
  background `bash`. Today it bypasses the gateway; Phase 3 folds it in behind a
  driver instead of building on it.
- `IRustEngineClient` / `RustEngineAPI` (`services/sandbox/rustClient.ts`,
  `types/engine.ts`) — the **engine driver seam**. `SandboxManager` already
  depends on the interface, not the concrete client. This is what we generalize.

---

## 2. Target architecture

Two layers, each behind an interface. The terminal never knows which sandbox
provider is underneath; the provider never knows about xterm.

```
 Browser        xterm ── ITransportStream (port) ────────────────┐
                          ├─ SseExecTransport   (line-mode, exec) │  transport
                          └─ PtyWsTransport      (interactive PTY) │  factory picks
                                                                   │  by capability
 Gateway    WS /pty  ─┐                                            │
            POST /exec ┼─▶ TerminalService ──▶ ISandboxDriver ◀────┘  driver seam
                       │                         ├─ OpenSandboxDriver (Rust→execd)
                       │                         ├─ AlibabaSdkDriver  (opensandbox SDK)
                       │                         └─ <future provider>
```

- **`ITransportStream`** stays the frontend port (already exists).
- **`ISandboxDriver`** is `IRustEngineClient` generalized + a session capability
  (below). One implementation per provider.
- **`TerminalService`** (new, backend) owns terminal sessions and bridges a
  driver session to the WS/SSE wire. Routes are thin.

### The driver interface (generalize what exists)

`IRustEngineClient` is already 90% of this — rename/relocate it to a
provider-neutral `ISandboxDriver` and add an optional **session** capability so
providers that support PTY can expose it and those that don't simply omit it:

```ts
// services/sandbox/drivers/ISandboxDriver.ts  (evolution of IRustEngineClient)
export interface ISandboxDriver {
  // --- lifecycle (unchanged from IRustEngineClient) ---
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(id: string): Promise<SandboxStatus>;
  pauseSandbox(id: string): Promise<boolean>;
  resumeSandbox(id: string): Promise<boolean>;
  destroySandbox(id: string): Promise<boolean>;

  // --- exec (line-mode; what we run today) ---
  resolveExecConnection(id: string): Promise<ExecConnectionInfo>;
  execCommand(id: string, payload: SandboxExecRequest): Promise<SandboxExecResult>;

  // --- OPTIONAL interactive session (PTY). Absent ⇒ driver is exec-only. ---
  openSession?(id: string, opts: PtyOptions): Promise<ISandboxSession>;
  capabilities(): DriverCapabilities; // { pty: boolean, exec: boolean }
}

export interface ISandboxSession {
  onData(cb: (chunk: Buffer) => void): void;   // pty stdout/stderr
  onExit(cb: (code: number) => void): void;
  write(data: string): void;                    // stdin
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface PtyOptions { cols: number; rows: number; cwd?: string; env?: Record<string,string>; shell?: string; }
```

`SandboxManager` keeps depending on the interface; `RustEngineClient` becomes
`OpenSandboxDriver` (no behavior change). Capability negotiation means the
transport factory can ask "does this sandbox's driver do PTY?" and pick
`PtyWsTransport` or fall back to `SseExecTransport`.

---

## 3. Phase 2 — interactive terminal (PTY)

The frontend half (`WebSocketTransport`) exists. Three things to build:

### 3a. A persistent PTY session in the sandbox — ⚠️ VERIFIED BLOCKED (2026-07-08)
Both approaches originally sketched here are **not buildable in this repo**, confirmed
by reading `execd`'s actual protocol (`src-rust/.../opensandbox.rs`, `execdriver.ts`):
- `execd` exposes **only** `POST /command` → SSE (`stdout`/`stderr`/`result`). No
  stdin channel, no PTY, no session, no WebSocket — and no execd source here (it's a
  prebuilt Go daemon in the container image). So "execd grows a `/session` endpoint"
  needs an external team.
- The "interim gateway `bash -i`" is impossible: the exec channel has **no stdin
  back-channel**, so a shell started that way could never receive a keystroke.

**The only interactive-capable backend that exists is the Alibaba SDK** (proven by
`SessionStream.ts`: `commands.run('bash',{background})` + `sendStdin` + `resize`). So
the PTY unblock is a **PTY-capable driver** (step 5), not an execd/gateway shell. The
provider-agnostic bridge (3b) and transport seam (3c) are built and waiting for it.

### 3b. Gateway WS bridge
- Add a WebSocket server on the gateway (`ws` package; upgrade the existing HTTP
  server — `server.ts` is plain Express today, so add one `server.on('upgrade')`
  handler, do **not** spin a second port).
- Route `GET /api/v1/sandboxes/:id/pty` (WS). On upgrade: enforce the **same
  sandbox-ownership guard** the FS/SSE routes use (IDOR), then
  `driver.openSession(id, {cols,rows})` and bridge, disambiguating by frame type:
  - inbound **binary** frame → `session.write` (stdin); inbound **text** JSON
    `{type:'resize',cols,rows}` → `session.resize`.
  - `session.onData` → WS **binary** send; `session.onExit` → WS **text**
    `{type:'exit',code}`, then close.
- Reuse `AbortController`/`req.on('close')` cleanup discipline from
  `execCommand`.

### 3c. Frontend transport factory
- `createTerminalTransport(sandboxId, caps)` returns `PtyWsTransport`
  (`WebSocketTransport` pointed at `/pty`) when `caps.pty`, else `SseExecTransport`.
- `IDETerminal` calls the factory instead of `new SseExecTransport` directly.
  One line; the rest of `IDETerminal` is unchanged.

**Gap B payoff:** a persistent PTY means there's a *real* session to resume, not
just visual scrollback. `SessionStore` already persists scrollback; once a PTY
exists, an optional `reattach` (keep the shell alive across a socket drop) makes
reconnect seamless.

---

## 4. Phase 3 — Alibaba SDK as *a* driver (not the foundation)

`SessionStream` proves the SDK can run a real `bash`. The goal is to keep that
capability while making OpenSandbox **replaceable**.

- Wrap the Alibaba `@alibaba-group/opensandbox` SDK in an `AlibabaSdkDriver`
  implementing `ISandboxDriver` (at minimum `openSession`, ideally lifecycle too).
  All SDK-specific types stay **inside this file** — nothing else imports the SDK.
- Choose where the SDK connection lives:
  - **Gateway-side (recommended):** the driver connects; the browser always
    speaks our `/pty` WS. Uniform auth, one wire protocol, SDK swappable with
    zero frontend change. Retire the browser-direct `SessionStream`.
  - Browser-direct (keep `SessionStream`): lower latency but leaks the vendor
    into the client and forks the auth path. Only if latency demands it.
- **Selection:** a `SANDBOX_DRIVER` env var (default `opensandbox`) picks the
  driver at boot, mirroring the existing `DOCKER_BUILDER`/`$DOCKER_REGISTRY`
  pattern. `SandboxManager` receives the chosen driver by injection (it already
  takes `IRustEngineClient` in its constructor — same seam).

Result: replacing OpenSandbox = writing one new `ISandboxDriver` and flipping an
env var. No terminal, VFS, or UI code changes.

---

## 5. Build order (each step ships independently)

- [x] **0.** `IRustEngineClient` → `ISandboxDriver` (new `drivers/ISandboxDriver.ts`);
      `RustEngineClient implements ISandboxDriver` + `capabilities()` returns
      `{exec:true, pty:false}`; `SandboxManager` now depends on the interface (field
      `driver`). Deviation from the plan: the concrete class stays named
      `RustEngineClient` in `rustClient.ts` — it resolves `index.node` via `__dirname`,
      so moving/renaming the file would silently break the FFI loader at runtime. A
      provider-neutral rename can ride the AlibabaSdkDriver work (step 5). No behavior
      change; all backend tests green.
- [x] **1.** `ISandboxSession` / `PtyOptions` / `DriverCapabilities` + optional
      `openSession` on `ISandboxDriver` (types only — no implementation yet, hence
      `pty:false`). This is the seam Phase 2 fills in.
- [~] **2.** Persistent PTY in the sandbox (3a) — ⚠️ **blocked**: execd is one-shot
      + external; no gateway-shell path exists (no stdin channel). Superseded by a
      PTY-capable driver (step 5) — see 3a.
- [x] **3.** Gateway WS `/pty` bridge (`api/PtyGateway.ts`) — provider-agnostic,
      reuses the IDOR guard on the upgrade handshake (`verifySandboxOwnership`),
      capability-gated (closes 1011 unless the active driver reports `pty`), bridges
      any `ISandboxSession` by frame type. `SandboxManager.capabilities()` /
      `openTerminalSession()` (wake-on-demand) added. Inert today (RustEngineClient
      is `pty:false`); self-check `PtyGateway.test.ts` proves the bridge with fakes.
- [x] **4.** Frontend transport factory (`createTerminalTransport`); `IDETerminal`
      uses it (picks SSE today, WS `/pty` when a driver advertises `pty`).
- [~] **5.** `AlibabaSdkDriver` — **scaffold landed, UNVERIFIED.** Composition over
      the Rust driver (lifecycle/exec delegate; only `openSession` is the SDK's job),
      `capabilities().pty = true`, selected by `SANDBOX_DRIVER=alibaba` (default
      `opensandbox`, unchanged). The `SdkSession` adapter (SDK bash+sendStdin+resize
      → `ISandboxSession`) mirrors the proven `SessionStream` calls and is unit-tested
      (`AlibabaSdkDriver.test.ts`, 4 cases incl. early-output buffering). SDK is
      dynamic-imported so the build stays green without it. **To finish (TODO(validate)
      in the file):** `npm i @alibaba-group/opensandbox` in the backend; confirm the
      SDK runs on Node + the server-side ConnectionConfig/auth is correct; confirm the
      process-exit event. Once green against a live sandbox, flip `capabilities` truth
      and the whole chain (driver → PtyGateway → WebSocketTransport) is live.
- [ ] **6.** PTY reattach across socket drops (pairs with Gap B session recovery).

---

## 6. Contracts to keep stable

- **Frontend port:** `ITransportStream` — do not change; add transports behind it.
- **WS PTY protocol** — disambiguated by **frame type**, not a tag field:
  - inbound (browser→gateway): **binary** = raw stdin bytes; **text** = JSON
    control, e.g. `{type:'resize',cols,rows}`.
  - outbound (gateway→browser): **binary** = raw PTY stdout/stderr; **text** =
    JSON lifecycle, e.g. `{type:'exit',code}`.
  `WebSocketTransport` already implements this side (binary stdin, text control,
  size re-synced on reconnect). Version the JSON control shapes if they change.
- **Driver seam:** `ISandboxDriver` — vendor SDK types never escape a driver file.

### Non-goals (YAGNI until asked)
Multi-user shared terminals, terminal recording/replay beyond scrollback, and
per-session resource quotas. None are needed for a single-user interactive shell.
