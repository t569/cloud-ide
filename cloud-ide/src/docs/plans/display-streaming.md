# Display Streaming — plan

Status: approved (decisions taken 2026-07-16). Branch: `feat/display`.
Related: [network-egress-layer.md](./network-egress-layer.md), [editor-detach.md](./editor-detach.md).

## Goal

Two things, one release:

**A. Restart controls** — a top-bar "Restart ▾" next to Detach with two clearly-labelled
actions: *Restart shell* (fresh PTY in the active terminal tab) and *Restart workspace*
(container swap via `POST /:id/restart` — applies rebuilt images AND egress changes).

**B. Interactive display** — a GUI app running in the sandbox (raylib game, pygame, any
X11 app) renders in an editor pane with full mouse/keyboard, the way web dev-servers
already render through the preview ingress. This is the "non-text stream" seam.

## Decisions (asked & answered)

| Question | Decision |
|---|---|
| v1 scope | **Interactive display only.** No audio (VNC carries none — a later WebRTC/audio slice), no media-file viewer. |
| Install path | **Per-env opt-in toggle** ("GUI display" on the environment) injecting the packages as a build step. Slim envs stay slim; a game env pays ~100MB once. |
| Shell restart | **Active terminal tab only** gets the fresh shell. |
| Interactivity | Full keyboard + mouse (games need input; view-only is not a real option). |

## Architecture (B)

```
┌ sandbox container ─────────────┐      ┌ gateway ──────────────┐     ┌ browser ─────────┐
│ Xvnc :99 (tigervnc =           │ TCP  │ WS /v1/sandboxes/:id/ │ WS  │ DisplayPane      │
│  X server + VNC, one process)  │◄────►│   display/stream      │◄───►│ (@novnc/novnc    │
│ user app: DISPLAY=:99          │ 5901 │  (ownership-gated     │     │  RFB client,     │
│ GL via mesa llvmpipe (sw)      │      │   upgrade, like PTY)  │     │  scale-to-fit)   │
└────────────────────────────────┘      └───────────────────────┘     └──────────────────┘
```

- **In-container stack:** `tigervnc-standalone-server` (Xvnc — X server and VNC server in
  ONE process; no Xvfb+x11vnc pair, no websockify — the gateway does the WS↔TCP bridge) +
  `libgl1-mesa-dri` (software OpenGL — raylib/GLFW get a GL context with no GPU) +
  `x11-xkb-utils` (keymaps). Installed by the opt-in build step.
- **Env config:** `EnvironmentConfig.displaySupport?: boolean`. When true: the generator
  injects the apt step, and the sandbox boots with `DISPLAY=:99` in `envVars` so every
  shell/process can just open a window.
- **Start (lazy, idempotent):** opening the pane calls `POST /v1/sandboxes/:id/display`,
  which execs `Xvnc :99` in the container if not already running (`-AlwaysShared`,
  `-SecurityTypes None`, geometry 1280x720). No boot-time daemon changes.
- **Transport:** gateway WS endpoint upgrades like PtyGateway (cookie + ownership on the
  upgrade — the SAME `userOwnsSandbox` rule), then pipes WS binary frames ↔ TCP :5901
  (raw RFB). ~60 lines on the existing `ws` dependency.
- **Client:** `@novnc/novnc` (new dep — an RFB protocol client is not "a few lines"; this
  is the one library whose job this is). `DisplayPane` mirrors `PreviewPane` and shares
  the right-hand split slot (preview OR display in v1).

## Trust model (same as dev servers — deliberately)

Xvnc listens on the container interface with `-SecurityTypes None`, exactly like a user's
dev server listens today. Protection layers: (1) the gateway WS endpoint is ownership-gated,
(2) enforced egress drops cross-tenant raw-IP east-west, so no neighbour can reach :5901.
On a DEGRADED host (no nf_tables) a neighbour could — the identical, documented exposure
dev servers already have there. Optional hardening later: per-boot random VNC password.

## Edge cases (the catalog)

| Case | Handling |
|---|---|
| Env without display support | Pane shows an enable-CTA → toggles `displaySupport` → rebuild → **Restart workspace** button (Part A closes this loop; today a rebuilt image had no apply path in the UI) |
| Xvnc not running / crashed | Start endpoint is idempotent (pgrep-guard); pane's Reconnect calls it again before reconnecting |
| Pause → resume | Frozen Xvnc thaws with the container; the dead socket triggers noVNC's reconnect |
| Workspace restart (new sandboxId) | Editor navigates to the new id; the pane remounts and start-on-open re-runs |
| Two tabs viewing one display | `-AlwaysShared` — both get the stream |
| `go run` before pane opened | `DISPLAY=:99` is always set, so the app errors clearly ("can't open display") instead of mysteriously; opening the pane first is the documented flow |
| Wayland-preferring apps (GLFW) | `WAYLAND_DISPLAY` unset → GLFW falls back to X11 — the wl headers issue is compile-time only |
| No GPU | llvmpipe software GL. A 60fps game will render at VNC-ish framerates — fine for dev preview, stated in docs |
| Resize | v1: fixed 1280x720, client scale-to-fit (`scaleViewport`). RFB SetDesktopSize later if it hurts |
| Degraded egress host | Dev-server-equivalent exposure, documented above |
| Clipboard, audio | Out of scope v1 (audio decided; clipboard is a noVNC flag away when wanted) |

## Slices (implement in order)

1. **Restart controls (A).** Bus event `WORKSPACE_RESTART_REQUESTED` handled in
   `EditorWorkspace` (restart → waitForRunning → navigate new id); NetworkPanel's button
   refactors to emit the same event (one handler, two entry points). `SHELL_RESTART_REQUESTED`
   handled by the terminal panel: dispose the active tab's session, spawn a fresh one.
2. **Backend display seam.** `POST /:id/display` (exec Xvnc idempotently) + the WS↔TCP
   bridge endpoint, both behind the existing ownership guard.
3. **Env opt-in.** `displaySupport` in shared types → generator injects the apt step →
   env-manager checkbox → `DISPLAY=:99` in the boot envVars.
4. **DisplayPane.** `@novnc/novnc` client, top-bar Display button (enabled when the env
   has support), share the preview split slot, Reconnect + scale-to-fit.
5. **E2E acceptance:** the actual raylib env — enable display, rebuild, restart, `go run`,
   play the game in the pane with keyboard input. Nothing ships until this works.

## Testing

- Unit: WS↔TCP bridge framing; generator injects the apt step + DISPLAY only when enabled;
  restart/shell bus events wire to the right handlers.
- E2E (slice 5) is the real gate.
