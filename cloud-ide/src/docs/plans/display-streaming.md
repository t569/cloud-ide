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

---

# Stage 2 — rich media (audio), and the multi-transport seam

Status: approved (2026-07-16). Video + input already ship (Stage 1 RFB pane). This stage
adds **audio** and reframes the pane as *N independent, ownership-gated transports keyed by
sandbox* — so a second window, a gamepad, or a clipboard channel is a plug-in, not a rewrite.

## What already exists (do NOT rebuild)

| Capability | Transport | Status |
|---|---|---|
| Video (framebuffer) | RFB over WS `/display/stream` → Xvnc :5901 | **shipped** |
| Mouse + keyboard | RFB (noVNC sends input back on the same socket) | **shipped** |
| Audio | — | this stage |

## Decision — audio transport

**Decoupled raw PCM**, chosen over Opus-now and full-WebRTC. The existing `bridge(ws, tcp)`
byte-pipe is transport-agnostic: audio is the SAME primitive pointed at a PulseAudio TCP tap
instead of RFB. One new small part on each side, opt-in, **zero new infra** (no signaling,
no STUN/TURN, no GStreamer).

```
┌ sandbox ─────────────────────────┐     ┌ gateway ─────────────┐     ┌ browser ──────────┐
│ pulseaudio -D (null-sink default) │ TCP │ WS /display/audio    │ WS  │ speaker toggle     │
│ app → cide sink → cide.monitor    │◄───►│  bridge() ↔ :4713    │◄───►│ AudioWorklet       │
│ module-simple-protocol-tcp :4713  │4713 │ (same pipe as RFB)   │ PCM │ int16→float, ring  │
│   record=true s16le 44100 2ch     │     │  ownership+Origin gated     │  buffer for jitter │
└───────────────────────────────────┘     └──────────────────────┘     └────────────────────┘
```

- **Why null-sink + monitor:** headless containers have no audio device. A `module-null-sink`
  named `cide` set as the default sink gives every app somewhere to play; its `.monitor` source
  is what we tap. Apps need no config — they hit the default sink.
- **Raw PCM, not Opus:** ~1.4 Mbps s16le/44.1k/stereo. On localhost/LAN (where the whole stack
  lives today) that is nothing, and it skips an encoder process + a browser decoder entirely.
  `ponytail: raw PCM — add Opus encode when a WAN/remote client makes 1.4Mbps hurt.`
- **AudioWorklet, not ScriptProcessorNode:** playback on the audio render thread (glitch-free,
  low latency); a small ring buffer absorbs WS jitter. int16-interleaved→float-planar conversion
  lives in the worklet, off the main thread.

## Tradeoffs (stated, not hidden)

- **A/V sync:** video (RFB) and audio (PCM) are independent transports with independent latency,
  so heavy scenes can drift a few frames from their sound. Fine for dev preview (hear your game's
  SFX, see it play). If broadcast-grade sync ever matters → Stage 3 muxes A/V in one WebRTC pipe.
- **Bandwidth:** raw PCM is WAN-unfriendly; see the Opus upgrade note above.
- **PulseAudio in a container:** needs `XDG_RUNTIME_DIR` (or `--disable-shm`); the exact daemon
  flags are real-world tuning the E2E gate validates, not something a minimal model sees.

## The seam (what makes it modular)

Each capability is ONE transport: a WS path + a container-side port + a browser-side consumer,
all sharing the SAME upgrade guard (Origin + cookie + `userOwnsSandbox`) and the SAME `bridge()`
pipe. To add a capability you add a `(path → port)` row and its consumer — nothing else moves.

| Capability | WS path | Container port | Consumer |
|---|---|---|---|
| Video+input | `/display/stream` | 5901 (RFB) | noVNC |
| Audio | `/display/audio` | 4713 (PCM tap) | AudioWorklet |
| *Second window* (future) | `/display/stream?win=N` | 590N | noVNC |
| *Gamepad* (future) | `/display/gamepad` | uinput shim | Web Gamepad API |

`ponytail: single window in v1 — the ?win=N / port-per-display generalisation lands when a
second window is actually asked for; the routing table above is the only thing that grows.`

## Slices (audio)

1. **Container stack.** `DisplayInjector` adds `pulseaudio`. `display.ts` gains `AUDIO_PORT` +
   idempotent `startAudio` (daemon, null-sink default, `module-simple-protocol-tcp` tap). Started
   from the same POST /display + boot path, non-fatal (no audio stack ≠ broken display).
2. **Gateway route.** `/display/audio` bridges to `AUDIO_PORT` via the existing `bridge()`;
   `isDisplayUpgrade` broadened so the unclaimed-socket closer leaves it alone.
3. **Frontend.** PCM AudioWorklet + a speaker toggle in `DisplayPane` (audio **off by default** —
   no surprise noise, no cost until enabled).
4. **Gate.** E2E: the raylib env with a sound-emitting build — enable display, hear the SFX in
   the pane while playing with keyboard input. Nothing ships until this works.

## Explicitly rejected (now)

- **Full WebRTC A/V rewrite (Selkies/neko/GStreamer):** correct *ceiling*, wrong *v1* — it
  discards the working sharp-input VNC path and adds signaling + STUN/TURN + an encoder pipeline
  for sync a dev preview does not need. It is Stage 3, triggered by a real 60fps-with-sync need.
- **Opus now:** an encoder process + browser decoder to save bandwidth that localhost/LAN does
  not spend. Add when a remote client measurably hurts.
