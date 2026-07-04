# 🔐 Editor Security Audit

Security review of `frontend/src/editor` and the trust boundaries it touches
(`vfs/`, `api/vfs.js`, `repl/`, `common/FileIcon.tsx`).

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

These flow through `core/VFSController.ts` and eventually to `api/vfs.js`, which
PUTs/GETs the `path` verbatim (`saveFile`, `getFile`, `deleteEntity`).

**Fixed:** Added a pure `safePath()` guard exported from `core/VFSController.ts`,
applied at the single choke point all CRUD events route through
(`FILE_OPEN_REQUESTED`, `FILE_CREATED`, `FILE_DELETED`, `FILE_RENAMED`). It
rejects `..` segments, null bytes, and empty paths, collapses `//` and `.`, and
forces a `/`-rooted path; unsafe input is dropped with a `console.warn`. Covered
by `core/VFSController.test.ts`. The backend **must** still re-validate — this is
defense at the client, not a substitute.

---

## 2. Sync/CRUD requests carry no auth or CSRF token · **High (design)** · ⚠️ PARTIALLY FIXED (client half done; IDOR is backend)

`vfs/VirtualFileSystem.ts` (`flushSyncQueue`, the git-sync POST) and every method
in `api/vfs.js` sent only `sandboxId` — no bearer token, no CSRF token, no
credentials handling.

**Client half — FIXED:**
- `lib/apiClient.ts` (the shared HTTP client, already used by env-manager) now
  sends `credentials: 'include'` on every request so the httpOnly session cookie
  reaches the backend, and attaches an `X-CSRF-Token` header (double-submit
  cookie pattern, via the pure `parseCsrfToken()` helper) on all state-changing
  methods (POST/PUT/PATCH/DELETE). Covered by `lib/apiClient.test.ts`.
- `api/vfs.js` was rewritten to route every VFS call through `apiClient` instead
  of hand-rolled `fetch()`, so all CRUD inherits the credential + CSRF handling
  (and this fixed a latent `/${API_BASE_URL}` double-slash URL bug).
- The still-mocked fetches in `vfs/VirtualFileSystem.ts` now carry TODOs that
  point at `apiClient`, so whoever wires the real backend inherits protection by
  default instead of hand-rolling an unprotected `fetch()`.

**Still required (backend — cannot be fixed in the front-end):**
- **CSRF cookie:** backend must set the `csrf-token` cookie (non-httpOnly) and
  the session cookie as `SameSite=Strict/Lax; Secure; HttpOnly`, and **reject**
  requests whose `X-CSRF-Token` header is missing or doesn't match the cookie.
- **CORS:** must set `Access-Control-Allow-Credentials: true` with an explicit
  (non-wildcard) origin for `credentials: 'include'` to work.
- **IDOR:** `sandboxId` is the only thing naming the target sandbox. Use an
  unguessable id **and** verify session ownership server-side on every request —
  the client cannot enforce this.

---

## 3. `jsWorker.js` runs `eval()` on REPL input · **Medium (by design, under-sandboxed)**

`repl/jsWorker.js:47` — `(1, eval)(code)`. It's a REPL, so execution is the
point, and it runs in a Web Worker (no DOM). But the worker still has `fetch`,
`postMessage`, and network access, so "run my JS" is also "exfiltrate anything
reachable from the worker origin." Acceptable for a local REPL; if it ever runs
untrusted/shared snippets, move it into a sandboxed iframe with a locked-down
CSP `connect-src`.

---

## 4. No Content-Security-Policy; `FileIcon` fetches from CDN + injects `img src` · **Low**

- `common/FileIcon.tsx:22-31` builds `` src={`src/common/icons/${localName}.svg`} ``
  from the icon registry. `localName` is registry-controlled today (not user
  input), and SVGs rendered via `<img>` don't execute script — so even a hostile
  slug is contained. The real gap: Iconify pulls SVGs from the network with no
  CSP restricting `img-src`/`connect-src`.
- **Add a CSP.** It's the single highest-leverage mitigation for the whole app:
  it backstops any future XSS and locks down where the REPL/worker can talk.

---

## 5. `localStorage` values injected into the DOM as CSS custom properties · **Low**

`context/DesignSystemContext.tsx:29-31` writes `settings.fontFamily` (read from
`localStorage` via `LocalStorageManager`) into
`root.style.setProperty('--ide-font-family', ...)`. `setProperty` validates the
value, so you can't break out into arbitrary CSS, and localStorage isn't
remotely writable without an existing XSS — defense-in-depth only. If a
font-family text input is ever surfaced, validate against an allowlist.

---

## Not vulnerabilities (verified)

- **Filename rendering** (tabs `components/EditorTabs.tsx`, explorer
  `components/FileExplorer.tsx`) — React-escaped JSX text. No stored XSS via
  malicious filenames.
- `window.prompt` / `window.confirm` for create/delete — fine.
- Monaco `Uri.parse(path)` model creation — internal, not a sink.

---

## Priority

Fix **#1 first.** A `normalizePath()` guard in `VFSController` closes the path
traversal at the single point every path routes through, in the shortest diff,
and it's the only finding fixable entirely in the front-end today — the rest
depend on the backend that's still `TODO`.
