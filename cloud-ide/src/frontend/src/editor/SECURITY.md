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
- `backend/src/api/middleware/security.ts` (new) provides `csrfProtection`
  (double-submit: mints the `csrf-token` cookie, rejects mutating requests whose
  `X-CSRF-Token` header is absent/mismatched with 403) and
  `requireSandboxOwnership(sessionRepo)` (the IDOR guard).
- `backend/src/server.ts`: `cors()` was wildcard-open with no credentials — now
  `cors({ origin: config.FRONTEND_ORIGIN, credentials: true })`; `csrfProtection`
  runs globally; a `GET /api/csrf` primes the token cookie.
- **IDOR closed:** `/api/fs/:sandboxId/*` had **zero** ownership check (anyone
  who knew a sandboxId could read/write/delete its files). Now every fs route
  runs `requireSandboxOwnership`, which loads the session from the httpOnly `sid`
  cookie and confirms `session.sandboxId === :sandboxId`, returning **404** (not
  403) on mismatch so ids can't be enumerated. The session id is a `crypto.randomUUID()`
  (unguessable). `SessionController.startSession` now issues the `sid` cookie
  (`httpOnly; SameSite=Lax; Secure in prod`), and the session routes — defined
  but previously **never mounted** — are now wired in `server.ts`.

**Remaining (ops):** set `Strict-Transport-Security` at the edge (HSTS is
header-only), and set `FRONTEND_ORIGIN` in the backend `.env` for production.
The frontend must adopt the session-start flow (call `POST /api/v1/sessions` to
obtain the `sid` cookie) before hitting `/api/fs` — today's mocked VFS doesn't
yet.

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

> Note: this closes command **injection**. Path **traversal** on the backend
> (e.g. `../../etc`) is a separate concern — the front-end `safePath()` (#1)
> blocks it from our UI, but the backend should still canonicalize paths against
> the sandbox workspace root. Tracked as defense-in-depth, not yet done.

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

All ranked findings are resolved. Remaining hardening is ops/defense-in-depth:
production CSP + HSTS headers at the edge (#4), backend path canonicalization
against the workspace root (#1/#6), and tightening `script-src` to nonces.
