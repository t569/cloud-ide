# ✍️ Cloud IDE: Editor Architecture & Implementation Guide

## Overview

This module is the code-editing surface of the Cloud IDE — the VS Code–style
shell that wraps **Monaco**, a file explorer, tabs, a terminal panel, and a
status bar into one workspace. Like the [terminal](../terminal/README.md), it is
built on a strict **event-driven, ports-and-adapters** philosophy: every part is
decoupled behind a contract so you can **replace it or build your own** without
touching the rest.

The two golden rules of this module:

1. **Components are dumb.** UI components (`FileExplorer`, `EditorTabs`,
   `TopNavBar`) never talk to data or each other — they only emit and react to
   events on the `EditorEventBus`. No prop-drilling, no cross-component imports.
2. **One choke point per concern.** All file I/O routes through `VFSController`;
   all language intelligence routes through a transport port; all Monaco
   knowledge lives in one bridge. Change behavior in one place, not ten.

> 🔐 Security note: this module has a companion audit, [`SECURITY.md`](./SECURITY.md).
> Path sanitization lives in `VFSController.safePath()` — keep new file
> operations behind it.

---

## Directory Structure

```plaintext
editor/
├── components/           # The "Dumb" UI Presentation Layer
│   ├── EditorWorkspace.tsx   # Composition root: wires every zone together
│   ├── TopNavBar.tsx         # File/Edit menus -> emits bus events
│   ├── ActivityBar.tsx       # Far-left icon rail + sync "traffic light"
│   ├── FileExplorer.tsx      # Recursive tree, driven by VFS_TREE_UPDATED
│   ├── EditorTabs.tsx        # Open-file tabs (dirty dot, delete strike-through)
│   ├── MonacoEditorWrapper.tsx # The Monaco boundary (models, themes, LSP install)
│   ├── CommandPalette.tsx    # Quick-open file switcher (Ctrl+P), bus-driven
│   ├── IDETerminal.tsx       # Bridges the terminal module into the editor bus
│   └── StatusBar.tsx         # Cursor / EOL / git info
├── context/              # React state engines
│   ├── WorkspaceContext.tsx  # useReducer: open files, active file, sync status
│   └── DesignSystemContext.tsx # Theme + font -> CSS variables (zero-FOUC)
├── core/                 # The Event Kernel & I/O Routing
│   ├── EditorEventBus.ts     # Typed Pub/Sub — the central nervous system
│   ├── VFSController.ts      # The "traffic cop": bus events <-> VFS + React
│   └── EditorInputManager.ts # Monaco keybindings (Ctrl+S, etc.) -> bus events
├── lsp/                  # Language Services (Ports & Adapters) — see below
│   ├── types.ts              # THE PORT: ILanguageServerTransport (no monaco!)
│   ├── MonacoLanguageBridge.ts # The ONLY monaco-aware adapter
│   ├── LanguageServiceRegistry.ts # Holds transports, installs bridges
│   ├── transports/           # Swappable backends
│   │   ├── MockLSPTransport.ts     # Zero-backend, for dev/tests
│   │   └── WebSocketLSPTransport.ts# Production daemon transport
│   └── manifest.ts           # THE one place you wire backends
├── utils/
│   ├── LocalStoragemanager.ts # Namespaced, per-sandbox layout persistence
│   ├── quickOpen.ts           # Pure helpers for the Command Palette (flatten/fuzzy)
│   └── themeAdapters.ts       # Palette -> CSS vars / xterm / monaco themes
├── types/editor.d.ts     # Single source of truth for editor types + bus payloads
├── SECURITY.md           # Security audit (findings + fixes)
└── README.md
```

---

## 1. The Nervous System (`core/EditorEventBus.ts`)

A strictly-typed Pub/Sub bus. Every payload is declared in
`types/editor.d.ts` under `EditorEventPayloads`, so `emit`/`on` are fully
type-checked and autocompleted. Emission is async (`setTimeout(0)`) to keep
handlers off the caller's stack.

The bus carries **one-way notifications only** — UI intent (`FILE_OPEN_REQUESTED`,
`SAVE_REQUESTED`, `TAB_CLOSED`) and engine broadcasts (`VFS_TREE_UPDATED`,
`FILE_LOADED`). It deliberately does **not** carry request/response traffic (see
the LSP section for why).

## 2. The Traffic Cop (`core/VFSController.ts`)

The bridge between the UI and the [VFS engine](../vfs/README.md). It subscribes
to bus events, translates them into `VirtualFileSystem` calls, and `dispatch`es
React state updates into `WorkspaceContext`. It is the **single choke point** for
file I/O — including `safePath()`, the path-traversal guard every create/open/
delete/rename runs through.

## 3. State (`context/`)

* **`WorkspaceContext`** — a `useReducer` store for `openFiles`, `activeFilePath`,
  and `syncStatus`. The controller dispatches; components read.
* **`DesignSystemContext`** — resolves the theme/font into CSS custom properties
  on `:root` via `useLayoutEffect` (no flash of unstyled content), and feeds
  `themeAdapters` for the terminal (xterm) and Monaco.

## 4. The Monaco Boundary (`components/MonacoEditorWrapper.tsx`)

The only component that imports Monaco directly. It creates one model per file
path (so cursor/undo survive tab switches), applies the theme, emits
`CONTENT_CHANGED` on keystroke, and installs the language services via the
registry. `EditorInputManager` intercepts keybindings into bus events.

---

## 5. Language Services — Ports & Adapters (`lsp/`)

This is the module's showcase of the decoupling philosophy, and worth
understanding before you extend it.

### Why a port, not the event bus?

Language features — completion, hover, go-to-definition — are **request →
response**: the editor asks a question and needs an *answer back*. The event bus
is fire-and-forget and cannot return a value. So language services get their own
contract: a **promise-returning transport port**.

### The three layers

```plaintext
  monaco  ◄──►  MonacoLanguageBridge  ◄──►  ILanguageServerTransport  ◄──►  backend
 (editor)      (the ONLY monaco code)         (the PORT — no monaco)      (mock / ws / yours)
```

1. **`ILanguageServerTransport` (the Port, `types.ts`)** — transport-agnostic,
   imports nothing from monaco. Capabilities are optional; a transport advertises
   only what it supports. Requests take an `AbortSignal` so a stale request is
   dropped the instant the user keeps typing (this keeps the editor fast).
2. **`MonacoLanguageBridge`** — the single monaco-aware adapter. It registers
   monaco providers, converts positions (monaco is 1-based, the port is 0-based
   LSP-style), maps completion kinds, and wires monaco's `CancellationToken` onto
   the port's `AbortSignal`. Written once, reused by every language. Replace
   monaco itself and this is the *only* file you touch.
3. **`LanguageServiceRegistry`** — maps `languageId -> transport` and installs
   the bridges on editor mount.

### How to add / swap a language backend

**You only edit `lsp/manifest.ts`.** Nothing else in the editor changes.

```typescript
// lsp/manifest.ts
export function createLanguageTransports(): ILanguageServerTransport[] {
  return [
    new MockLSPTransport('python'),                              // dev default
    // new WebSocketLSPTransport('python', `${WS_BASE_URL}/lsp/python`), // go live
    // new WebSocketLSPTransport('typescript', `${WS_BASE_URL}/lsp/ts`),
    // new MyWasmTransport('rust'),                              // your own
  ];
}
```

### How to write your own transport

Implement the port. That's the whole contract:

```typescript
// lsp/transports/MyTransport.ts
import { ILanguageServerTransport, CompletionItem, CompletionParams } from '../types';

export class MyTransport implements ILanguageServerTransport {
  constructor(public readonly languageId: string) {}

  async provideCompletions(params: CompletionParams, signal: AbortSignal): Promise<CompletionItem[]> {
    // Call your LSP/WASM/API however you like. Honour `signal` to stay fast.
    return [{ label: 'hello', kind: 'function', insertText: 'hello' }];
  }
  // provideHover?, onDiagnostics? are optional — implement only what you support.
}
```

Add it to the manifest and it lights up. No changes to any component, the bridge,
or the registry.

### The Golden Rule of Language Services

* **Add a capability** to the **port + bridge** when the editor needs a new *kind*
  of intelligence (e.g. `provideDefinition`).
* **Add a transport** when you have a new *source* of that intelligence (a new
  backend). Never put backend logic in the bridge, and never put monaco types in
  a transport.

---

## Data Flow: opening and editing a file

1. **Explorer click** → `FileExplorer` emits `FILE_OPEN_REQUESTED`.
2. **Routing** → `VFSController` runs `safePath()`, reads the file from the VFS,
   dispatches `OPEN_FILE`, emits `FILE_LOADED`.
3. **Render** → `MonacoEditorWrapper` creates/loads the model for that path.
4. **Typing** → Monaco `onChange` emits `CONTENT_CHANGED`; the controller marks
   the tab dirty and calls `vfs.updateFile()` (optimistic).
5. **Intelligence** → as the user types, Monaco asks the `MonacoLanguageBridge`
   for completions; the bridge calls the language's transport and translates the
   result back — cancelling any request the user has already typed past.
6. **Save** → `Ctrl+S` (`EditorInputManager`) emits `SAVE_REQUESTED`; the
   controller forces a VFS sync.

---

## Performance notes (the "lightweight & fast" mandate)

* **One model per path**, reused across tab switches — no re-parsing.
* **Cancellable language requests** via `AbortSignal` — no wasted work on stale
  keystrokes.
* **Optimistic VFS updates** — the UI never blocks on the network.
* **Dumb components + a reducer** — state changes are localized re-renders, not
  prop-drilled cascades.
* Keep new work behind these seams: a new feature is usually a new **transport**,
  a new **bus event**, or a new **dumb component** — not a change to the core.

---

## Design Notes — Session Lifecycle & Boot

Decisions behind how the editor is booted and how it connects to the rest of the app
(env-manager, routing). These are the "why", not the "how" — see `REFACTOR.md` for the
build log and `../../../ARCHITECTURE.md` (Phase 3) for the roadmap.

* **The editor is a thin shell booted from a `WorkspaceSession`.**
  `EditorWorkspace` takes one prop: `session { sandboxId, workspaceName?, envConfig?,
  snapshot?, plugins? }` (`types/editor.d.ts`). `sandboxId` is the only requirement; the
  rest are optional seams a host fills in. This is the single hand-off point into the
  editor — nothing else reaches in.

* **Env-manager stays decoupled from routing *and* provisioning.** It emits
  `onLaunch(env)` and nothing more. The **page** (`pages/Environments.tsx`) owns the
  side effects: provision a sandbox from the built image (`api/sandbox.ts`) and
  `navigate('/editor/:sandboxId')`. Same philosophy as the dumb components — a feature
  module never learns about sandboxes or URLs.

* **Native router, zero deps.** `pages/router.tsx` exposes `useLocation()` +
  `navigate()` over the History API (React 19 `useSyncExternalStore`). A flat route
  table (`/environments`, `/editor/:sandboxId`) doesn't justify a dependency. Upgrade to
  `react-router` only when routes nest or need loaders.

* **The URL carries only `sandboxId`; a warm boot bridges the rest.** A full
  `envConfig` is too big for a query string, so the launch stashes the session in
  `pages/sessionStore.ts` (in-memory) before navigating; `AppShell` reads it. A **cold
  deep-link** (refresh, shared URL) finds nothing and falls back to `{ sandboxId }` — the
  editor refetches env details from the backend. Warm path is rich, cold path still works.

* **Environment variables are applied at container boot, not per-exec.**
  `envConfig.env` flows once through `SandboxSpec.envVars` at provision time, so the
  container process carries them and every terminal exec inherits them. We deliberately
  do **not** inject env per command — that's the wrong layer (and the terminal transport
  is still a mock).

* **Launch waits for `RUNNING`.** `bootSandbox` may return `PROVISIONING`; the VFS needs
  a live workspace to hydrate, so `Environments.handleLaunch` gates on the sandbox
  reaching `RUNNING` (`api/sandbox.ts:waitForRunning`) before entering the editor.

* **UI surfaces (menus, activity items) come from a contribution registry.**
  `core/ContributionRegistry` is seeded by the built-in `contrib/coreContributions`
  plugin; extra plugins layer on via `session.plugins`. Adding a panel or menu is a
  plugin, not an edit to `EditorWorkspace`.

---

# 🗺️ Roadmap & TODO

### ✅ Phase 1: Core Shell (Completed)
- [x] Event-bus kernel (`EditorEventBus`) with fully-typed payloads.
- [x] VFS routing via `VFSController` (open/save/create/delete/rename).
- [x] `WorkspaceContext` reducer (tabs, active file, sync status).
- [x] Monaco integration: one model per path, theme, keybindings.
- [x] Zones: TopNav, ActivityBar, Explorer, Tabs, Terminal, StatusBar.
- [x] Per-sandbox layout persistence + drag-resize.

### ✅ Phase 2: Security Hardening (Completed — see `SECURITY.md`)
- [x] `safePath()` path-traversal guard on every file op.
- [x] Credentialed + CSRF-protected API client; backend ownership (IDOR) guard.
- [x] REPL worker network lockdown; CSP + security headers.

### ✅ Phase 3: Language Services & UX (Completed)
- [x] **Ports & Adapters LSP** — `ILanguageServerTransport`, one Monaco bridge,
      swappable transports (Mock + WebSocket).
- [x] **Diagnostics** — push-based `onDiagnostics` → Monaco markers (squiggles).
- [x] **Command Palette / Quick Open** (`Ctrl+P`) — fuzzy file switcher.

### ✅ Phase 4: Deeper Intelligence (Completed)
- [x] **Go-to-definition** — `provideDefinition` on the port, a bridge
      `registerDefinitionProvider`, and the `'definition'` method in
      `WebSocketLSPTransport`.
- [x] **Real `Save All`** — `VFSController` special-cases `SAVE_REQUESTED
      { path: 'ALL' }`: `forceSync()` flushes the whole dirty queue, then the
      `MARK_ALL_SAVED` reducer clears every open tab's dirty flag.
- [x] **Signature help** — `provideSignatureHelp` on the port + a bridge
      `registerSignatureHelpProvider` (triggers on `(` and `,`).
- [x] **Format document** — `COMMAND_FORMAT` (Shift+Alt+F) runs monaco's format
      action; `provideFormatting` on the port lets a language server supply the
      edits via `registerDocumentFormattingEditProvider`.
- [x] **Rename symbol** — `provideRename` capability + a bridge
      `registerRenameProvider` returning a multi-file `WorkspaceEdit`.
- [x] **Format on save** — `formatOnSave` global setting; the `Ctrl+S` handler
      runs the format command (awaited) before emitting `SAVE_REQUESTED`, so the
      formatting edits are queued into the VFS before the flush.

> Every Phase-4 feature is an **optional port capability** — the language
> intelligence lives entirely in transports, and the editor lights up whatever a
> transport advertises. This is the payoff of the ports-and-adapters refactor:
> six features added, zero changes to the core kernel or the components.

### ⏳ Phase 5: Backend Wiring (Blocked on backend) — see `ARCHITECTURE.md` Step 10
- [ ] Point `lsp/manifest.ts` at a real language-server daemon over
      `WebSocketLSPTransport` (protocol already implemented).
- [x] Replace the VFS mock (`vfs/VirtualFileSystem.ts`) with live `apiClient` calls
      (Step 10a): `hydrateWorkspace()` walks `/api/fs/:id/ls` recursively, `readFile()`
      lazy-loads via `/read`, and `flushSyncQueue()` persists edits via `/write` +
      `/delete`. Last-write-wins — no merkle/conflict protocol yet.
- [ ] `chokidar` FS-watch → `VFS_TREE_UPDATED` so external file changes (npm
      install, git) refresh the explorer. This is `ARCHITECTURE.md` Step 10b (SSE
      push channel) + 10c (the watcher + `VFSController` `FS_EVENT` handler).
