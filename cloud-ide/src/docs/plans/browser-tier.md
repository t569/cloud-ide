# Browser tier — the IDE with no server

Status: **BUILT** (2026-07-23, branch `feat/wasm`). Files, git and the editor all run in the
page. Not yet exercised in a real browser — see [Unverified](#unverified).

Related: [`wasm-runtime.md`](./wasm-runtime.md) (the server-side WASM tier and the hosting
analysis this follows from), [`git-integration.md`](./git-integration.md) (the backend git
surface this mirrors), [`workspace-entity.md`](./workspace-entity.md).

## Why

The product offers a **choice of tier**, and the user picks:

| Tier | Compute runs | Costs the operator | Trade |
|---|---|---|---|
| **Free** | the user's **browser** | **nothing, unmetered** | ~10× on interpreted code, no native modules, no terminal |
| **Fast** | a hosted sandbox | a provider's free allowance, then usage | full fidelity |

WASM on a server still needs a server. Only moving compute into the browser removes the
bill entirely — and with it the persistent disk that forced a VM, which is what lets the
backend become a stateless control plane that fits on free serverless.

## The seam: `editor/core/tier.ts`

Resolved **once**, threaded into every engine, so no component branches on the tier.

```ts
createTier({ sandboxId, tier, workspaceId, corsProxy })
  → { kind, files: FileStore, git: GitPort, hasSandbox, ensureReady() }
```

- `server` → `HttpFileStore` + `HttpGitPort`, `hasSandbox: true`
- `browser` → `OpfsFileStore` + `BrowserGitPort`, `hasSandbox: false`

**`hasSandbox: false` is the honest part.** There is no container, therefore no terminal, no
preview, no language server, and **no filesystem-change stream** — nothing else is writing
to the workspace, so there is nothing to stream. `VFSController` skips its `EventSource` on
that basis rather than opening one against a backend that isn't there and reconnecting
forever.

## Storage: two ports, one tree

| Port | Purpose | Server impl | Browser impl |
|---|---|---|---|
| `vfs/FileStore.ts` | the 5 operations the VFS needs | `HttpFileStore` (`/api/fs`) | `OpfsFileStore` (OPFS) |
| `vfs/GitPort.ts` | version control | `HttpGitPort` (`/api/git`) | `BrowserGitPort` (isomorphic-git) |

`vfs/OpfsFs.ts` sits **below** `FileStore`: a node-`fs`-shaped promises API that
isomorphic-git drives. It is separate because git needs binary I/O, `mkdir`, `stat` and
`unlink` — bending a five-text-operation port into that shape would serve neither.

**Both address the same OPFS namespace, and that is the property the tier rests on.** They
are independent classes; nothing but a test guarantees they agree. A mismatch would look
like commits that silently miss the user's edits, so `editor/core/tier.test.ts` asserts a
file written through the *store* is seen by *git*.

Optional-by-type, rather than stubs that throw:

- **`FileStore.readExternal`** — absent in the browser. There is no filesystem outside the
  workspace, and the type says so.
- **`GitPort.diff`** — absent in `BrowserGitPort`. isomorphic-git ships no unified-diff
  formatter, and shipping a diff algorithm to fill a UI panel is not worth it. The Source
  Control pane already handles a file it cannot diff, so it takes that path.

## Entry: a ROUTE, not a session

`/local/:workspaceId` (`AppShell`), reached from the **Browser** button on `/workspaces`.

The tier lives in the URL deliberately. `sessionStore` is in-memory, so a reload or a shared
link would lose it and silently fall back to the server path — fatal for the one tier whose
whole point is working without a server. `openLocalWorkspace()` also skips `launch()`: there
is nothing to provision and nothing to wait for, so `POST /v1/sessions` would be inventing
work.

## Git over the network needs a proxy

Git hosts send no `Access-Control-Allow-Origin`, so a page cannot speak smart-HTTP to
github.com. Every clone/push/pull goes through `backend/src/api/GitProxyRoutes.ts`, mounted
at `/api/git-proxy`. Without one configured, `BrowserGitPort` fails with that reason rather
than an opaque fetch error.

⚠️ **That endpoint fetches a caller-supplied URL while forwarding the caller's
`Authorization` header** — an SSRF primitive and a credential-forwarding primitive at once.
It is therefore not a general proxy:

- **host allow-list**, matched exact-or-subdomain (never `includes`, which accepts
  `evil-github.com`)
- **path allow-list** of only the three smart-HTTP endpoints
- **https only**
- **redirects not followed** — a cross-host 302 would carry the `Authorization` header
  somewhere the allow-list never approved

Live-verified against real GitHub: ref discovery returns a genuine pkt-line advertisement,
while the cloud metadata address, a look-alike host and `api.github.com/user` all 403.

## Known trades

- **The PAT moves into the browser**, reversing `git-integration.md`'s decision to run git
  host-side to keep it server-side. Supplied per call via `onAuth`, never stored by the port
  — but it is in the page.
- **Durability is per-device.** OPFS is origin-private and evictable unless
  `navigator.storage.persist()` is granted. Cross-device continuity is a git remote, nothing
  else. **The workspace-entity model becomes "durable in *this* browser."**
- **Shallow clone only** (`depth: 50`). isomorphic-git cannot do git's blobless partial
  clone, and a browser has neither the storage nor the patience for deep history.
- **Racily-clean writes.** isomorphic-git keeps a stat cache and skips re-hashing when size
  *and* mtime match; OPFS `lastModified` is millisecond resolution, so two same-length
  writes inside one millisecond read as unchanged. Real git solves this; this library does
  not. Harmless while VFS writes are debounced 2 s apart.

## Two traps worth not rediscovering

1. **isomorphic-git probes `Object.getOwnPropertyDescriptor(fs, 'promises')`**, which does
   not see prototype accessors. A class getter falls through to the callback-style path and
   dies inside `bindFs` with `Cannot read properties of undefined (reading 'bind')`.
   `promises` must be an **own enumerable property**, as node's own `fs.promises` is.
2. **It branches on `err.code`.** `ENOENT` means "not there"; `EEXIST` from `mkdir` means
   "carry on". An adapter throwing plain `Error`s fails in ways that read like corruption.

## Unverified

**The OPFS path in a real browser.** OPFS does not exist outside one, so the tests drive it
through an in-memory fake (`vfs/fakeOpfs.ts`, binary-backed — a text-only fake would pass
while the real thing corrupted every commit). The wiring, the git operations and the
production bundle are proven; *"open `/local/:id` and watch files survive a hard refresh"*
is not.

## Next

- Credentials for this tier. The Source Control pane's token box still calls `/api/git`,
  which is user-scoped and server-side; folding it into `GitPort` means first deciding where
  a browser-tier token lives.
- WASM execution in the page, so the free tier can *run* code and not only edit it. The
  toolchain work is shared with the server tier — see [`wasm-runtime.md`](./wasm-runtime.md).
