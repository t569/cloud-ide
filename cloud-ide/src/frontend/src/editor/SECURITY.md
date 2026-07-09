# 🔐 Editor Security Audit

Security review of `frontend/src/editor` and the trust boundaries it touches
(`vfs/`, `api/vfs.ts`, `repl/`, `common/FileIcon.tsx`).

**TL;DR:** The editor is a React front-end whose real trust boundary is the
**path string** and **file content** it hands to the backend VFS. Classic
server-side vulns (SQLi, SSRF) live in the backend, but the editor *originates*
the tainted data and today does **zero validation** before it crosses the wire.
No `dangerouslySetInnerHTML` exists in the editor, so stored XSS via filenames
is not currently possible — keep it that way.

Findings ranked by severity.

---

## 1. Path traversal — no sanitization on the path pipeline · **High** · ✅ FIXED

Every path that reaches the backend filesystem is user-controlled and
unvalidated:

| Source | Location | Problem |
|--------|----------|---------|
| New File prompt | `components/TopNavBar.tsx:56-62` | Raw text, only prepends `/`. `../../../etc/passwd` passes straight into `FILE_CREATED` → `vfs.createFileOrDir`. |
| Terminal file-click bridge | `components/IDETerminal.tsx:99-107` | `handleContextFileClick` takes a filename **sniffed out of terminal output** and emits `FILE_OPEN_REQUESTED` with `` /${fileName} ``. Terminal output is attacker-influenceable (any program can print a path), so a crafted build log becomes a file-read primitive. |
| Open File picker | `components/TopNavBar.tsx:66-83` | Uses `` /${file.name} ``; a filename containing `..` is possible on some platforms. |

These flow through `core/VFSController.ts` and eventually to `api/vfs.ts`, which
PUTs/GETs the `path` verbatim (`saveFile`, `getFile`, `deleteEntity`).

**Fixed:** Added a pure `safePath()` guard exported from `core/VFSController.ts`,
applied at the single choke point all CRUD events route through
(`FILE_OPEN_REQUESTED`, `FILE_CREATED`, `FILE_DELETED`, `FILE_RENAMED`). It
rejects `..` segments, null bytes, and empty paths, collapses `//` and `.`, and
forces a `/`-rooted path; unsafe input is dropped with a `console.warn`. Covered
by `core/VFSController.test.ts`. The backend **must** still re-validate — this is
defense at the client, not a substitute.

---

## 2. Sync/CRUD requests carry no auth or CSRF token · **High** · ✅ FIXED (client + server)

`vfs/VirtualFileSystem.ts` (`flushSyncQueue`, the git-sync POST) and every method
in `api/vfs.ts` sent only `sandboxId` — no bearer token, no CSRF token, no
credentials handling.

**Client half — FIXED:**
- `lib/apiClient.ts` (the shared HTTP client, already used by env-manager) now
  sends `credentials: 'include'` on every request so the httpOnly session cookie
  reaches the backend, and attaches an `X-CSRF-Token` header (double-submit
  cookie pattern, via the pure `parseCsrfToken()` helper) on all state-changing
  methods (POST/PUT/PATCH/DELETE). Covered by `lib/apiClient.test.ts`.
- `api/vfs.ts` was rewritten to route every VFS call through `apiClient` instead
  of hand-rolled `fetch()`, so all CRUD inherits the credential + CSRF handling
  (and this fixed a latent `/${API_BASE_URL}` double-slash URL bug).
- The still-mocked fetches in `vfs/VirtualFileSystem.ts` now carry TODOs that
  point at `apiClient`, so whoever wires the real backend inherits protection by
  default instead of hand-rolling an unprotected `fetch()`.

**Server half — FIXED (backend):**
- `backend/src/api/middleware/security.ts` provides `csrfProtection`
  (double-submit: mints the `csrf-token` cookie, rejects mutating requests whose
  `X-CSRF-Token` header is absent/mismatched with 403) and
  `requireSandboxOwnership(sandboxRepo)` (the IDOR guard).
- `backend/src/api/middleware/auth.ts` (new) is the **identity seam**. There is no
  login yet: it mints a per-browser anonymous `uid` (httpOnly, `crypto.randomUUID()`)
  on first contact and answers "who is this request". Everything else asks it.
- `backend/src/server.ts`: `cors()` was wildcard-open with no credentials — now
  `cors({ origin: config.FRONTEND_ORIGIN, credentials: true })`; `csrfProtection`
  then `attachUser` run globally; a `GET /api/csrf` primes the cookies.
- **IDOR closed, then closed properly.** The first fix keyed ownership off the
  `sid` session cookie and `session.sandboxId === :sandboxId`. That never worked:
  the only issuer of `sid` is `POST /api/v1/sessions`, which at the time the
  frontend never called — so `/api/fs/*` 404'd for everyone, and a session links to
  exactly one sandbox anyway. Ownership now lives on the record: `provision()` stamps
  `SandboxRecord.userId` from the identity seam (never from the request body), and
  `userOwnsSandbox` compares it to the caller. Returns **404**, not 403, so ids
  cannot be enumerated. One user may own many sandboxes.
  **Since ARCHITECTURE 9e the frontend *does* call `POST /api/v1/sessions`** (it is the
  launch path — see below), so `sid` is now actually issued. Ownership deliberately
  stayed on `SandboxRecord.userId`: `sid` is a *connection* id, `uid` is the identity,
  and only `uid` is signed. **Do not reintroduce `sid` as an authorization input.**
- **Guard coverage widened, then made structural.** `/api/fs/:sandboxId/*` was the
  only guarded surface. Every `/api/v1/sandboxes/:sandboxId` route — `exec`, `pause`,
  `resume`, `destroy`, `volumes`, status — was protected by CSRF alone, which stops
  another *site* forging a request but does nothing to stop this browser asking for a
  sandbox it does not own. All are now owner-gated, as is the PTY WebSocket
  upgrade (`readUserId`, not `currentUser` — an upgrade has no response to mint on).
  The first fix listed `ownsSandbox` on each route in `server.ts`, which is
  **fail-open**: a route added later is unprotected until someone remembers. Sandbox
  routes now live in `api/SandboxRoutes.ts` behind `router.use('/:sandboxId', …)`,
  matching `createFileSystemRouter`/`createPreviewRouter` — the guard is inherited by
  construction, and the collection routes (`POST /`, `GET /`) stay open because they
  have no `:sandboxId` to own. Enforced by `__tests__/sandbox-routes.test.ts`, which
  drives a real router over real HTTP; deleting the guard fails 14 of its cases.
  Admin force-destroy is deliberately **outside** that router — it acts on other
  users' sandboxes by design and must not inherit the ownership guard.
  `SessionController`'s warm-sandbox reuse is also scoped to the caller; it would
  otherwise hand you someone else's running workspace. **This is now a live path**
  (`POST /v1/sessions` is how the editor launches), not dead code: the
  `(!sbx.userId || sbx.userId === userId)` filter in `startSession` is a real
  authorization boundary and is covered by `backend/__tests__/session-controller.test.ts`.
  The `!sbx.userId` disjunct is the same legacy-adoption branch as `userOwnsSandbox`
  and must be deleted at the same time as it.

- **`uid` is HMAC-signed** (`<uuid>.<sig>`), so a caller cannot self-assert an
  identity by setting the cookie. A bad signature is *no* identity, never a valid
  one. `AUTH_SECRET` is required in production — the server refuses to boot without
  it rather than issue forgeable identities; dev generates and persists a key at
  `data/.auth-secret` (gitignored).
- **Admin routes fail closed.** `DELETE /api/v1/admin/sandboxes/:id` (god-mode
  force-destroy, which skips the dirty-worktree pre-flight and deletes the
  worktree) was mounted with **no authentication of any kind** — any HTTP client
  could destroy any sandbox and its uncommitted work. CSRF never covered it; that
  constrains browsers, not `curl`. Now behind `requireAdmin` (`X-Admin-Token`),
  and 404 whenever `ADMIN_TOKEN` is unset, which is the default.
- **`/preview/:sandboxId/:port` is owner-gated.** It proxies HTTP straight into a
  sandbox's ports and had no check at all: anyone knowing an id could reach another
  user's dev server, and `wakeOnDemand` would resume their paused container. The
  guard runs *before* wake, so an unauthorized caller cannot even force a resume.
- **CSRF compare is constant-time** (`timingSafeEqual`), and a missing header is
  always a rejection — never "skip the check when unset".
- **Baseline headers** on every response: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and
  HSTS when actually serving TLS. No CSP here — this server emits no HTML; the
  SPA's CSP belongs where the SPA is served.
- **PTY WebSocket upgrade checks `Origin`.** The handshake is not covered by CORS
  and carries cookies (Cross-Site WebSocket Hijacking). `SameSite=Lax` mostly
  blocks it; the explicit check is defense in depth and covers non-browser clients.
- **The SPA primes its cookies.** `ensureCsrfToken()` calls `GET /api/csrf` when no
  token exists, so a cold load that POSTs first (restored session, deep link) no
  longer 403s.

**Known holes in the stub (must close when login lands):**
- The `uid` cookie is a **bearer token**: no expiry, no revocation. Whoever holds
  the value is that user until `AUTH_SECRET` rotates. Signing stops forgery, not theft.
- `userOwnsSandbox` **adopts** records with no `userId` (provisioned before the
  seam existed) so running workspaces survived the upgrade. Delete that branch.
- Clearing cookies orphans that browser's sandboxes (IdleSweeper reaps them).
- `/api/environment/*` has **no ownership model at all** — every environment is
  global, so any user can edit, build, roll back or delete any environment. This is
  intentional for a single-tenant dev tool and becomes a real hole the moment the
  identity seam means anything. Environments need an ownerId exactly like sandboxes.
- `DELETE /api/v1/sessions/:sessionId` does not verify the session belongs to the
  caller. Low impact (ids are `randomUUID`, and it only emits a disconnect event).
  It briefly looked worse: that event marks a session `DISCONNECTED`, which
  `IdleSweeper` once read to decide what to pause — a guessed id would have
  force-paused someone's workspace. The sweeper now derives liveness from the SSE
  subscriber ref-count and never reads session state, so that path is closed.
  Owner-gate the route anyway; nothing should be able to write another user's session.
- No rate limiting anywhere.

**Remaining (ops):** set `AUTH_SECRET`, `ADMIN_TOKEN` (or leave unset to keep admin
disabled) and `FRONTEND_ORIGIN` in the production `.env`; terminate TLS at the edge
so the `Secure` cookie flag and HSTS engage.

---

## 3. `jsWorker.js` runs `eval()` on REPL input · **Medium (by design, under-sandboxed)** · ✅ FIXED

`repl/jsWorker.js` — `(1, eval)(code)`. It's a REPL, so execution is the point,
and it runs in a Web Worker (no DOM). But the worker had `fetch` + network
access, so "run my JS" was also "exfiltrate anything reachable from the worker
origin" — and after finding #2 those same-origin calls ride the user's session
cookie, so a shared/pasted snippet could read authenticated VFS data and beacon
it out.

**Fixed:** The worker now revokes every network + code-loading primitive
(`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`,
`Worker`, `SharedWorker`, `navigator.sendBeacon`) in a locked
`Object.defineProperty` (writable/configurable `false`) at the very top of the
file, before any user code runs. This REPL needs zero network, so nothing
breaks; `importScripts`/`Worker` are revoked too, so eval'd code can't pull a
fresh reference, and the lock blocks reassignment. `postMessage` (the legit
channel back to xterm) is intentionally preserved.

Note: the Python/Ruby REPL workers are **not** given this treatment — they fetch
their WASM runtimes (Pyodide / ruby.wasm) from a CDN at init and genuinely need
network. If they ever run untrusted code, they need the iframe+CSP approach
instead of blanket revocation.

---

## 4. No Content-Security-Policy; `FileIcon` fetches from CDN + injects `img src` · **Low** · ✅ FIXED

- `common/FileIcon.tsx` builds `` src={`src/common/icons/${localName}.svg`} ``
  from the icon registry. `localName` is registry-controlled (not user input),
  and SVGs rendered via `<img>` don't execute script — so even a hostile slug is
  contained. The real gap was: no CSP restricting `img-src`/`connect-src`.

**Fixed:** CSP + companion security headers are set in `frontend/vite.config.ts`:
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options:
  DENY` (clickjacking) on **both** dev and preview (they never break anything).
- A full **Content-Security-Policy** on `vite preview` (the built artifact) —
  **not** on `vite dev`, which needs inline scripts + an HMR websocket a strict
  policy would block. The policy locks `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, and — the high-value directive —
  an egress allowlist (`connect-src 'self'` + the Iconify CDNs) that caps where
  any script can send data, backstopping XSS and the REPL worker. It allowlists
  exactly what the app needs: `worker-src blob:` (Monaco), `'unsafe-eval'`
  (REPL/Monaco), Google Fonts (`style-src`/`font-src`), and `img-src 'self'
  data:`.

**Still required (backend/edge — cannot be set by Vite):** serve the same CSP as
a real response header at the production edge/backend, add
`Strict-Transport-Security` (HSTS only works as a header), and tighten
`script-src` from `'unsafe-inline'`/`'unsafe-eval'` to per-request nonces/hashes.
Add your API/WS origin to `connect-src` if it is not same-origin.

---

## 5. `localStorage` values injected into the DOM as CSS custom properties · **Low**

`context/DesignSystemContext.tsx:29-31` writes `settings.fontFamily` (read from
`localStorage` via `LocalStorageManager`) into
`root.style.setProperty('--ide-font-family', ...)`. `setProperty` validates the
value, so you can't break out into arbitrary CSS, and localStorage isn't
remotely writable without an existing XSS — defense-in-depth only. If a
font-family text input is ever surfaced, validate against an allowlist.

---

## 6. Shell command injection in `FileSystemManager` (backend) · **Critical** · ✅ FIXED

`backend/src/services/FileSystemManager.ts` interpolated caller-supplied paths
straight into `/bin/sh -c` strings (`base64 "${filePath}"`, `rm -rf
"${pathToRemove}"`, `mkdir -p "${dirName}"`, `ls -1p "${dirPath}" | awk ...`,
`echo "${b64}" | base64 -d > "${filePath}"`). The double quotes are not
escaping — a path containing `"`, `` ` ``, `$(...)`, or `;` broke out and ran
arbitrary commands **inside the target container** (RCE in the sandbox).

**Fixed:** every method now passes paths as **argv** to `execBuffered` (which
runs execve-style, no shell), so a path is only ever a literal argument:
- `readFile` → `['base64', filePath]`
- `deletePath` → `['rm', '-rf', pathToRemove]`
- `listDirectory` → `['ls', '-1p', dirPath]`, with the directory/file
  classification (previously an `awk` pipe) moved into Node.
- `writeFile` → `['mkdir','-p',dirName]`, then — because a pipe+redirect needs a
  shell and the exec API has no stdin — `['/bin/sh','-c','printf %s "$1" |
  base64 -d > "$2"', 'sh', b64Content, filePath]`. The untrusted values are
  shell **positional parameters** (`$1`/`$2`), which the shell substitutes as
  literal data and never re-parses as code, so there is no injection.

Verified against a real shell: the old interpolation created an attacker canary
file; the new positional form did not.

> Note: this closes command **injection**. Backend path **traversal** is now
> also closed independently (see #7 below) — the backend no longer trusts the
> client's path.

---

## 7. Backend path traversal — client path not trusted · **High** · ✅ FIXED

**Was:** the FS routes passed `req.query.path` / `req.body.path` straight to the
filesystem. The front-end `safePath()` (#1) only guards our own UI; a crafted
request (curl) could send `/workspace/../../etc/passwd`.

**Fixed:** `FileSystemManager.resolveHostPath()` is the single choke point every
public method (`ls`/`read`/`write`/`delete`) routes through, and it now blocks
both escape classes:
1. **Lexical** (`..`, absolute paths) — strip the `/workspace` prefix, `path.resolve`
   against the worktree root, reject anything not under `root + sep`.
2. **Symlink** — `path.resolve` doesn't follow links, so a worktree that checked
   out `evil -> /etc` or `-> ../<other-sandbox>` would pass the lexical guard and
   `node:fs` would follow it. We `realpath` the deepest existing ancestor and
   require it to stay inside the real root, blocking host + cross-tenant reads.

Self-check: `backend/services/FileSystemManager.test.ts` (lexical escape, symlink
escape via a directory junction, and a valid in-workspace round-trip).
Residual: TOCTOU under concurrent untrusted symlink creation (none today — only
git checkout writes symlinks); upgrade path is `O_NOFOLLOW` opens.

---

## Not vulnerabilities (verified)

- **Filename rendering** (tabs `components/EditorTabs.tsx`, explorer
  `components/FileExplorer.tsx`) — React-escaped JSX text. No stored XSS via
  malicious filenames.
- `window.prompt` / `window.confirm` for create/delete — fine.
- Monaco `Uri.parse(path)` model creation — internal, not a sink.

---

## Status

| # | Finding | Severity | State |
|---|---------|----------|-------|
| 6 | Shell command injection in `FileSystemManager` | Critical | ✅ Fixed |
| 1 | Path traversal (front-end path pipeline) | High | ✅ Fixed |
| 2 | No auth/CSRF on sync/CRUD; IDOR | High | ✅ Fixed (client + server) |
| 3 | REPL `eval()` under-sandboxed | Medium | ✅ Fixed |
| 4 | No CSP / security headers | Low | ✅ Fixed (edge header still owed) |
| 5 | localStorage → CSS custom property | Low | ➖ Accepted (defense-in-depth only) |
| 7 | Backend path traversal (client path not trusted) | High | ✅ Fixed (lexical + symlink) |

All ranked findings are resolved. Remaining hardening is ops/defense-in-depth:
production CSP + HSTS headers at the edge (#4) and tightening `script-src` to nonces.
