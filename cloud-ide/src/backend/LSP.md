# 🧠 Language Servers (LSP) — setup & architecture

Live code intelligence — completions, hover, go-to-definition, diagnostics,
formatting, signature help, rename — served by real language servers running
next to the gateway. Backed by `src/services/lsp/` + `src/api/LspRoutes.ts`,
driven from the browser by `frontend/src/editor/lsp/`.

**LSP is optional.** With nothing configured the editor still runs on Monaco's
built-in highlighting; every language just reports `offline`. Turning it on is
one env var plus a running server — no code change.

---

## 🧭 Why a proxy (the shape that matters)

A browser cannot open a raw TCP socket or an SSH tunnel, and language servers
speak neither HTTP nor JSON over the web. So the gateway sits in the middle:

```
 browser  ──debounced HTTP + SSE──▶  gateway (LspProxy)  ──stdio / TCP──▶  language server
          ◀─────── JSON / SSE ──────                     ◀── JSON-RPC ───
```

- **Frontend** (`HttpLSPTransport`) turns editor intents into `POST /api/lsp/:sandboxId/:languageId/:method`
  and subscribes to diagnostics over SSE. Requests are debounced and cancellable;
  when the backend is unreachable it degrades to empty results + `offline` status
  so typing never blocks.
- **Backend** (`LspProxy` → `LspSession`) owns one JSON-RPC session per
  `(sandbox, language)`, framed with `Content-Length` headers over a `Duplex`.
  The Duplex comes from `execStream.ts` (in-sandbox, **preferred**) or
  `tcpConnector.ts` (beside the gateway).

### Two kinds of server, and why it matters
| | `exec:` — **in the sandbox** | `host:port` — **beside the gateway** |
|---|---|---|
| Transport | `docker exec -i` stdio (raw pipes, no TTY) | TCP socket |
| Sees | the container: venv, `node_modules`, cargo registry, `GOMODCACHE` | only the bind-mounted worktree |
| Imports resolve? | **yes** | no — anything installed in the image is invisible |
| Paths | already `/workspace` — no mapping | host paths, mapped both ways |
| Isolation | one server process per sandbox | shared; repo config (tsconfig, pylsp plugins) executes on the **gateway** |

Prefer `exec:`. The gateway-side server is fine for a quick single-language setup,
but it can't resolve a dependency it cannot see, and it runs repo-supplied config
outside the sandbox boundary.

A server process is spawned **once per `(sandbox, language)`**, on first use, and
reused for every later request — never per keystroke. When the container dies the
stream closes and the session is evicted, so the next request opens a fresh one.

### Document sync is a **hybrid + incremental**
- **Lazy `didOpen`** reads the file from the worktree on first use — zero payload,
  correct at open.
- **Live `didChange`** sends *incremental deltas* (`POST …/sync` with `{ path, changes[] }`).
  The session keeps a **full-text mirror** of each open doc, folds the deltas in,
  and hands the server the complete buffer — so any server is correct regardless of
  its declared sync capability. A full-snapshot resync (sent on the first change and
  after any failed POST) self-heals a dropped delta. See `services/lsp/textEdit.ts`.

### Single-node assumption
The **TCP** path assumes the server shares the gateway's disk, so host paths **are**
the server's paths (`LspProxy` maps `file://` URIs through `FileSystemManager`'s
trust boundary). The **exec** path makes no such assumption: the server is in the
container and already speaks `/workspace`.

Going remote swaps only the injected transport (`openExecStream` / `connect`) and the
path mapper — the protocol engine is untouched. A WebSocket-backed execd stream would
implement `openExecStream` and nothing else would change.

---

## 🚀 Setup

### 1. Declare it on the environment (recommended — this is the whole setup)

```jsonc
// EnvironmentConfig
{
  "name": "My Rust env",
  "baseImage": "rust:1.79",
  "buildSteps": [ /* ... */ ],
  "languageServers": ["rust"]        // <- that's it
}
```

One field, and the rest is wired for you:

| | |
|---|---|
| **build** | `LspInjector` appends the install as the **last** layer of the runtime stage (so it can't invalidate your dependency layers). |
| **runtime** | `LspProxy` spawns the server in that sandbox over `docker exec -i`. |
| **editor** | asks `GET /api/lsp/:sandboxId/languages` and builds its transports from the answer. |

All three read the same table, [`shared/languageServers.ts`](../shared/languageServers.ts),
so they cannot drift. An unknown id **fails the build** rather than leaving the editor
quietly dumb.

| id | server | notes |
|---|---|---|
| `python` | python-lsp-server | |
| `typescript`, `javascript` | typescript-language-server | one install serves both |
| `rust` | rust-analyzer | |
| `go` | gopls | |
| `c`, `cpp` | clangd | one install serves both; wants `compile_commands.json` for exact flags, heuristics otherwise |
| `shell` | bash-language-server | the id is `shell`, not `bash` |

Not included on purpose: `json`/`html`/`css` (Monaco already ships workers for these —
a server would be a slower second copy) and `java`/`csharp`/`ruby` (jdtls, OmniSharp,
Solargraph are heavyweight; add one when someone actually needs it).

No ports, no `socat`, no daemon to supervise, and **no frontend change** to add a
language. The base image must already carry the toolchain the install needs (`pip`,
`npm`, `rustup`, `go`) — that's the image's job, and the build fails loudly if not.

To add a language to the table, add one entry (`install` + `command`) — the pipeline
and the proxy both pick it up.

### 1b. …or run one beside the gateway (fallback)

Simpler to try, but blind to anything installed in the image — expect unresolved
imports. Stdio-only servers need a TCP shim:

```bash
pip install "python-lsp-server[all]" && pylsp --tcp --host 127.0.0.1 --port 2087
socat TCP-LISTEN:2089,reuseaddr,fork EXEC:'typescript-language-server --stdio'
```

> `socat ...,fork` spawns a fresh server per connection, so each sandbox gets its own
> process. A shared daemon (e.g. `gopls serve -listen`) shares state across *every*
> sandbox — prefer fork, or prefer `exec:`.

### 2. `LSP_SERVERS` — the manual override (gearheads)

Only needed if you did **not** declare `languageServers` on the env: it points the
gateway at a server you started yourself. Semicolon-separated,
`language=exec:<argv>` or `language=host:port`.

```bash
# a server you installed in the image by hand
LSP_SERVERS="python=exec:pyright-langserver --stdio" npm run dev

# a server beside the gateway
LSP_SERVERS="python=127.0.0.1:2087;typescript=127.0.0.1:2089" npm run dev
```

**Precedence: the environment wins.** If the env declares a language, its in-container
server is used and any `LSP_SERVERS` entry for that language is ignored — falling back
to a gateway-side server would silently hand the editor one that can't see the
sandbox's dependencies.

`exec:` (either route) requires a driver that can open an exec stream
(`DockerPtyDriver`). On a driver without one the language reports `offline`, Monaco
highlighting takes over, and the health card says so — it never breaks the editor.

The **language key must match the editor's language id** — the id
`LanguageRegistry.detect()` returns and the transport sends. That's why the table is
keyed by it. `manifest.ts` no longer hardcodes anything: it asks
`GET /api/lsp/:sandboxId/languages` and builds a transport per answer.

### 3. Verify

- The editor status bar shows the LSP indicator flip from `offline` → `connected`
  when a supported file is open.
- `GET /api/health` → the **`lsp`** card is expandable and lists one child per
  configured server (never worse than `degraded` — a dead server must not pull the
  node from rotation). TCP servers report reachability + latency; `exec:` servers
  report as configured, since they are per-sandbox and there is no sandbox in scope
  during a node health check. See [HEALTH.md](./HEALTH.md).
- Type in a supported file: completions/hover/diagnostics should reflect the live,
  unsaved buffer (the incremental sync at work).

---

## 🔌 HTTP contract

All routes are sandbox-scoped and IDOR-guarded by the session cookie, exactly
like `/api/fs`.

| Method / path | Body | Result |
|---|---|---|
| `POST /api/lsp/:sandboxId/:languageId/:method` | port params | JSON result |
| `POST /api/lsp/:sandboxId/:languageId/sync` | `{ path, changes[] }` | `204` |
| `GET  /api/lsp/:sandboxId/:languageId/diagnostics` | — | SSE `{ path, diagnostics }` |

`:method` is a port method (`completion`, `hover`, `definition`, `formatting`,
`signatureHelp`, `rename`); `changes[]` are LSP incremental content changes
(a ranged edit, or a single `{ text }` full-replacement snapshot).

A request for an unconfigured language returns `503` — which the transport reads
as `offline` and falls back to Monaco highlighting.

---

## 🗂️ Files

| File | Role |
|---|---|
| `services/lsp/framing.ts` | `Content-Length` message codec |
| `services/lsp/LspSession.ts` | JSON-RPC over a `Duplex`; handshake, req/resp, didOpen/didChange, diagnostics fan-out; full-text mirror |
| `services/lsp/textEdit.ts` | pure incremental-change application (delta → full text) |
| `services/lsp/tcpConnector.ts` | `net.Socket` → `Duplex` (a server beside the gateway) |
| `services/sandbox/drivers/execStream.ts` | child process stdio → `Duplex` (raw pipes, no TTY) |
| `drivers/DockerPtyDriver.openExecStream` | `docker exec -i` into the sandbox — the in-container transport |
| `services/lsp/lspMethods.ts` | pure port ↔ LSP method + path mapping |
| `services/lsp/LspProxy.ts` | session registry keyed `sandbox:lang`; `parseLspServers`; deployment seams injected |
| `api/LspRoutes.ts` | the routes above, mounted at `/api/lsp` |
| `frontend/src/editor/lsp/transports/HttpLSPTransport.ts` | browser transport: debounced HTTP + SSE, incremental sync, offline fallback |
| `shared/languageServers.ts` | **the one table**: language id → (install command, exec argv). Build + runtime both read it |
| `pipeline/middleware/injectors/LspInjector.ts` | build-time pass: appends the install as the last runtime layer |
| `frontend/src/editor/lsp/manifest.ts` | asks the backend which languages this sandbox has, builds a transport per answer |
