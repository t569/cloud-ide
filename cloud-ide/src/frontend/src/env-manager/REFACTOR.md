# 🧱 Env-Manager Architecture Refactor

Goal: **one source of truth per package manager**, faster icons (offline), less code.
Decisions: full manifest • frontend only • delete dead legacy code.

## Why

Today the same 10 package managers are re-described in ~6 places, and icons hit a
CDN on every render. Concretely:

| Concern | Today (scattered) | After (manifest) |
|---|---|---|
| Provider dispatch | `RegistryFactory` switch + singleton classes | `MANAGERS[type].search` |
| File parsing | `DependencyParserRegistry` array + `IFileParser` classes | `MANAGERS[type].parse` |
| Accepted extensions | `getAcceptedExtensions` switch | `MANAGERS[type].acceptExts` |
| Step / registry icons | `StepIcon` + `RegistryIcon` hardcoded maps | `MANAGERS[type].icon` via `<EnvIcon>` |
| Type list | `INSTALL_STEPS` **and** `SUPPORTED_INSTALL_STEPS` | single `INSTALL_STEPS` |
| Package/base icons | `cdn.simpleicons.org` **per render** + `react-icons/si` | `@iconify/react` (offline) |

Adding a manager: **6+ files → 1 file + 1 manifest line.**

## Target layout

```
env-manager/registry/
  types.ts          # PackageManager, PackageSearchResult
  index.ts          # MANAGERS + searchRegistry() / parseFile() / acceptExts() / iconFor()
  managers/*.ts     # one file per InstallStepType: { label, icon, color, cors, search, parse?, acceptExts? }
  EnvIcon.tsx       # <EnvIcon type=.../> and <EnvIcon icon=.../> — offline iconify
```
`MANAGERS: Record<InstallStepType, PackageManager>` — TS forces an entry per type.

## Plan (each phase leaves the app working) — ✅ COMPLETE

### Phase 0 — Types foundation ✅
- [x] `shared/types/env.ts`: collapsed `SUPPORTED_INSTALL_STEPS` into `INSTALL_STEPS`; fixed `linx/arm64` typo. Only consumer (`BuildStepCard`) repointed.
- [x] `registry/types.ts`: `PackageManager` interface + `PackageSearchResult`.

### Phase 1 — Icon unification (the speed win) ✅
- [x] `icon`/`color`/`label` per manager in the manifest.
- [x] `EnvIcon.tsx`: renders manifest icon via `@iconify/react` (cached SVG). Replaced `StepIcon` + `RegistryIcon`.
- [x] `BaseImageIcon` + `PackageIcon`: render via `@iconify/react` — removed CDN-per-render, `console.log`, bad `import { set }`.
- [x] Repointed usages; deleted `StepIcon.tsx`, `RegistryIcon.tsx`.

### Phase 2 — Search manifest ✅
- [x] Each provider class → a `search` fn in its `managers/*.ts` (maven/gradle share `searchMavenCentral`).
- [x] `searchRegistry` reads the manifest.
- [x] Deleted `Registryfactory.ts`, `IRegistry.ts`, `providers/`.

### Phase 3 — Parser manifest ✅
- [x] Each parser class → a `parse` fn + `acceptExts` in `managers/*.ts` (pip merges requirements+pyproject).
- [x] `useDependencyParser` reads `parseFile`/`acceptExtsFor` from the manifest.
- [x] Deleted `DependecyParserRegistry.ts`, `IFileParser.ts`, `utils/parsers/`.

### Phase 4 — Dead code + docs ✅
- [x] Deleted `EnvironmentManager.jsx`, `frontend/utils/packageIcons.tsx`, `frontend/utils/icons.jsx` (verified unreferenced).
- [x] Updated env-manager `README.md`.

### Phase 5 — Verify ✅
- [x] `tsc --noEmit` clean (only pre-existing `vitest` test-config errors remain); `vite build` green.
- [x] Manual smoke (Playwright, live dev server): npm search returned results with brand icons (React logo + npm fallback), `package.json` upload parsed to `[react, express, typescript, vite]`, base-image (Ubuntu) + step icons rendered. **0 console errors, 0 `cdn.simpleicons.org` requests, icons served via iconify API (cached).**

## Notes / decisions log
- Per-package logos preserved via `simple-icons:<slug>` through iconify — cached inline SVG, no CDN `<img>` per render.
- `@iconify/react` fetches each icon's data once from the Iconify API, then caches (localStorage) — so it's one fetch per unique icon vs. the old one request per *render*.
- `RegistryError` kept (soft-validation UX in Go/Zig/others).
- Result: adding a package manager is now **1 file + 1 manifest line** (was 6+ files). `Record<InstallStepType, …>` makes a missing entry a compile error.
- ⚠️ Bundle is 763 kB (single chunk) — pre-existing, unrelated to this refactor. Code-split later if it matters.
