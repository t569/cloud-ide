# Cloud IDE — project philosophy

A browser IDE that provisions real, isolated dev environments: define an environment,
build it into a Docker image, launch a sandbox, and edit/run code in it — with an editor
and terminal meant to rival a desktop IDE.

This file is the *why*. The *how* lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md) and the
per-module `README.md`s — don't duplicate them here; extend them there.

---

## Two mandates

Everything in this repo serves one of two goals. When a change trades one against the
other, say so out loud.

### 1. Robust, decoupled architecture

Strong separation of concerns. Every subsystem sits behind a contract and can be replaced
or extended **without touching its neighbours**. Two rules make this concrete:

- **One choke point per concern.** All file I/O goes through `VFSController`; all docker
  invocation through `DockerCli`; all language intelligence through one transport port and
  one Monaco bridge. Change behaviour in one place, not ten.
- **Dumb components, typed buses.** UI components emit and react to events on a typed
  event bus — they never talk to data or each other. No prop-drilling, no cross-imports.

Two load-bearing examples of the seam philosophy:

- **Storage = git worktrees, not a bespoke store.** One git worktree per sandbox
  (`WorktreeEngine`, branch `sbx-<id>`). Git already *is* our content-addressed tree +
  write-ahead log, so we don't hand-roll a Merkle tree, a sync protocol, or crash recovery.
  Read [`ARCHITECTURE.md` → "git IS our Merkle tree + WAL"](./ARCHITECTURE.md) before you
  propose one. **Version control is the same seam, extended, not a second system:** clone,
  commit, push, branch are real `git` in that worktree (host-side, PAT server-side) — never
  a browser-REST parallel store. Lightweight via `--filter=blob:none` partial clone (lazy
  blob fetch). See [`docs/plans/git-integration.md`](./docs/plans/git-integration.md).
- **Provisioning = a strategy seam.** `SandboxManager` depends only on `ISandboxDriver`;
  `createSandboxDriver()` picks the implementation. Builds go through `IBuilder` +
  `BuilderRegistry`; the store behind `IBuildStore`. Swapping a provider, build backend, or
  persistence layer is a new file behind an interface — never a rewrite. Vendor/FFI types
  never leak past their one driver file.

The payoff to protect: the system stays decoupled enough to scale to more providers, more
build backends, and multiple nodes without a core rewrite. Single-node shortcuts
(in-process ref-counts, JSON stores) are deliberate and each names the seam it grows into.

### 2. Uncompromising user experience

The visual/interactive layer gets the same rigour as the backend — it is the product.

- **Persistent, independent design system.** Themes and fonts resolve to CSS custom
  properties on `:root` (`DesignSystemContext`), applied via `useLayoutEffect` so there is
  **zero flash of unstyled content**. Themes are data, added without touching components.
- **Frontend stability is a feature.** No layout shift, no WebGL context loss on tab
  switches, no focus-stealing, no UI-thread blocking. The terminal and editor are built
  around these pitfalls on purpose (see their READMEs) — a stable, sharp surface is what
  makes this feel like a desktop IDE rather than a web toy.

---

## Working here

- **Read the module's `README.md` first.** They are current and detailed — the docs *are*
  the design. Start from [`ARCHITECTURE.md`](./ARCHITECTURE.md)'s documentation map.
- **A feature is usually a new adapter, not a core edit** — a new driver, transport,
  injector, bus event, or dumb component. If you're editing the kernel, question it.
- **Keep the seams honest.** Return truthful `capabilities()`; put vendor SDKs behind their
  driver; keep the one choke point the only path. A shortcut past a seam is the 3am pager.
- **Match the surrounding code** — its naming, its comment density, its idioms.

Setup, host checks, and how to run the stack: [`README.md`](./README.md).
