# Editor Refactor — progress tracker

Refactor of `EditorWorkspace` into a modular, decoupled, extendable shell, plus the
seam by which **env-manager boots into the editor** carrying a session.

Plan: `~/.claude/plans/binary-juggling-graham.md`.

## Why

`EditorWorkspace.tsx` was type-clean but tangled: hardcoded menu/activity config,
duplicate drag handlers, inline layout/persistence/bootstrap. A second **legacy
editor** (`WorkspaceEditor` + `useWorkspaceEditor`, used only by the old
`pages/IDEWorkspace`) owned the real `editorUtils.js` type error. `main.tsx` rendered
`<EditorWorkspace/>` with no `sandboxId` — the likely root of the "bus is broken" note.

## Target architecture

```
main.tsx → App (view switch) → pages/IDEWorkspace → EditorWorkspace(session)
                             ↘ EnvManager  ──boot(session)──┘

EditorWorkspace (thin shell)
 ├─ useWorkspaceBootstrap  → EditorEventBus + VFSController + LSP registry + fileTree
 ├─ useWorkspaceLayout     → layout state + localStorage persistence
 ├─ usePanelResize         → one drag helper (was 2 duplicates)
 └─ ContributionRegistry   ← coreContributions plugin (menus + activity items)
                           ← session.plugins[]   (extension point)
```

`WorkspaceSession { sandboxId, workspaceName?, envConfig?, snapshot?, plugins? }` is
the boot contract env-manager hands to the editor. `envConfig`/`snapshot` are typed
seams (not yet consumed).

## Progress

| # | Task | Status |
|---|------|--------|
| 1 | `hooks/useWorkspaceLayout`, `usePanelResize`, `useWorkspaceBootstrap` | ✅ done |
| 2 | `core/ContributionRegistry` + `IEditorPlugin` type + `contrib/coreContributions` | ✅ done |
| 3 | `WorkspaceSession` type + thin `EditorWorkspace(session)` | ✅ done |
| 4 | `pages/AppShell` view switch, repurpose `pages/IDEWorkspace`, clean `main.tsx`, delete legacy | ✅ done |
| 5 | `tsc --noEmit` clean (editor/main/pages) + prod `vite build` succeeds | ✅ done |

Notes: shell landed at `pages/AppShell.tsx` (the existing `App.tsx` is an unrelated
icon-registry dev harness — left untouched). Deleted legacy: `WorkspaceEditor.tsx`,
`useWorkspaceEditor.ts`, `api/vfs.ts`.

Legend: ⬜ todo · 🟡 in progress · ✅ done

## Deferred (architecture enables, not built here)

Snapshot create/restore; paused/live sandbox resume page; full env-field → editor
handoff (deep `onBoot` wiring inside EnvManager); backend chokidar `FS_EVENT` →
`vfs.hydrateWorkspace()`; real StatusBar cursor/git wiring. Frontend `vitest` isn't
installed, so `*.test.ts` typecheck failures are a pre-existing infra gap.
