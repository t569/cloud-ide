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
 browser  ──debounced HTTP + SSE──▶  gateway (LspProxy)  ──TCP socket──▶  language server
          ◀─────── JSON / SSE ──────                     ◀── JSON-RPC ──
```

- **Frontend** (`HttpLSPTransport`) turns editor intents into `POST /api/lsp/:sandboxId/:languageId/:method`
  and subscribes to diagnostics over SSE. Requests are debounced and cancellable;
  when the backend is unreachable it degrades to empty results + `offline` status
  so typing never blocks.
- **Backend** (`LspProxy` → `LspSession`) owns one JSON-RPC session per
  `(sandbox, language)`, framed with `Content-Length` headers over a `Duplex`
  (`tcpConnector.ts` today; an SSH `forwardOut` is a drop-in later).

### Document sync is a **hybrid + incremental**
- **Lazy `didOpen`** reads the file from the worktree on first use — zero payload,
  correct at open.
- **Live `didChange`** sends *incremental deltas* (`POST …/sync` with `{ path, changes[] }`).
  The session keeps a **full-text mirror** of each open doc, folds the deltas in,
  and hands the server the complete buffer — so any server is correct regardless of
  its declared sync capability. A full-snapshot resync (sent on the first change and
  after any failed POST) self-heals a dropped delta. See `services/lsp/textEdit.ts`.

### Single-node assumption
The language server shares the gateway's disk, so host paths **are** the server's
paths (`LspProxy` maps `file://` URIs through `FileSystemManager`'s trust boundary).
Going remote swaps only the injected `connect` + path resolvers — the protocol
engine is untouched.

---

## 🚀 Setup

### 1. Run a language server on a TCP port

Language servers speak stdio by default; expose one over TCP with a small shim.
Examples:

**Python — [pyright](https://github.com/microsoft/pyright)** (via `pyright-langserver`):
```bash
npm i -g pyright
# bridge stdio <-> TCP with socat (or any equivalent):
socat TCP-LISTEN:2087,reuseaddr,fork EXEC:'pyright-langserver --stdio'
```

**Python — [python-lsp-server](https://github.com/python-lsp/python-lsp-server)** (native TCP):
```bash
pip install "python-lsp-server[all]"
pylsp --tcp --host 127.0.0.1 --port 2087
```

**TypeScript — [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server)**:
```bash
npm i -g typescript typescript-language-server
socat TCP-LISTEN:2089,reuseaddr,fork EXEC:'typescript-language-server --stdio'
```

> The server must run on the **same host/filesystem as the gateway** (see the
> single-node assumption above). In the WSL-only setup, run it inside the distro.

### 2. Point the gateway at it

Set `LSP_SERVERS` before starting the backend. Format:
`language=host:port`, semicolon-separated.

```bash
# one language
LSP_SERVERS="python=127.0.0.1:2087" npm run dev:backend

# several
LSP_SERVERS="python=127.0.0.1:2087;typescript=127.0.0.1:2089" npm run dev
```

The **language key must match the editor's language id** — the id the frontend
detects and the transport sends. Today the manifest wires `python`; add others
in `frontend/src/editor/lsp/manifest.ts`:

```ts
// frontend/src/editor/lsp/manifest.ts
new HttpLSPTransport('python', sandboxId),
new HttpLSPTransport('typescript', sandboxId),   // then add it to LSP_SERVERS too
```

### 3. Verify

- The editor status bar shows the LSP indicator flip from `offline` → `connected`
  when a supported file is open.
- `GET /api/health` → the **`lsp`** card is expandable and lists one child per
  configured server with TCP reachability + latency (never worse than `degraded`
  — a dead server must not pull the node from rotation). See [HEALTH.md](./HEALTH.md).
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
| `services/lsp/tcpConnector.ts` | `net.Socket` → `Duplex` (SSH tunnel is a drop-in) |
| `services/lsp/lspMethods.ts` | pure port ↔ LSP method + path mapping |
| `services/lsp/LspProxy.ts` | session registry keyed `sandbox:lang`; `parseLspServers`; deployment seams injected |
| `api/LspRoutes.ts` | the routes above, mounted at `/api/lsp` |
| `frontend/src/editor/lsp/transports/HttpLSPTransport.ts` | browser transport: debounced HTTP + SSE, incremental sync, offline fallback |
| `frontend/src/editor/lsp/manifest.ts` | the one place you wire a language to a transport |
