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

---

# Optimization store (speed & memory) — a browser editor pays for every idle byte

Status: **store only, not scheduled.** This is the backlog of speed/memory wins for the
display stack, written down *before* implementing so we pick from it deliberately. It is a
GUI stream — a VNC framebuffer decoder, an audio worklet, two WS byte-pipes, software GL and
a PulseAudio daemon — so it is the heaviest new compute/memory consumer in the whole client.

**Sequencing rule (from the mandate): land Tier 1 first, and only Tier 1, until the feature
is fully soaked and the E2E gate is green. Tiers 2–3 change behaviour or architecture — they
wait until we are *sure* they can't break the working sharp-input path.** Don't reach for the
WebCodecs rewrite to save bytes a lifecycle guard already saves for free.

Each item names the **win**, the **risk**, and the **trigger** that should promote it.

## Tier 1 — safe, additive, do first (lifecycle + config; cannot break the transport)

These are the "optimise early" wins: none touches the RFB/PCM protocol or the `bridge()` seam.
They are pure adds — a guard, a lazy import, a config flag.

| # | Win | What | Risk | Trigger |
|---|---|---|---|---|
| **O1** ✅ | **Pause when unseen** | **DONE.** `DisplayPane` tracks `active = on-screen (IntersectionObserver) AND tab-visible (visibilitychange)`; when false it tears down the RFB and suspends the AudioContext, and rebuilds on return (POST /display idempotent). The container process keeps running — only browser decode + WS + Xvnc encode stop. Immediate pause/resume (ponytail: debounce only if tab-flip thrash appears). | — | shipped |
| **O2** ✅ | **Lazy-load the pane + noVNC** | **DONE.** `DisplayPane` is now `React.lazy` behind a `Suspense` boundary in `EditorWorkspace`, so `@novnc/novnc` + the audio-worklet glue parse only on first open — out of the initial editor bundle for the common case. | — | shipped |
| **O3** ✅ | **Gateway backpressure** | **DONE.** `bridge()` now pauses the container-side TCP read above a 4MB high-water mark and resumes on drain (the `ws.send` flush callback is the drain signal); bytes stay byte-for-byte (RFB can't drop them). Client→container left unthrottled (human-rate input). `DisplayGateway.test.ts` covers pause-on-backpressure/resume-on-drain. | — | shipped |
| **O4** | **Tune Xvnc + noVNC encoding** | Xvnc runs defaults; `DisplayPane` sets only `scaleViewport`. Set noVNC `qualityLevel`/`compressionLevel`, and pick Xvnc `-DeferUpdate` (coalesce a busy frame window) + Tight/JPEG params. Cuts bandwidth **and** browser decode CPU on mixed/photographic content. | Low — all config; wrong values only trade quality↔latency, never correctness. Measure, don't guess. | **Now**, once O1/O2 land — cheapest compute/byte reduction. |
| **O5** | **Shrink the audio ring** | The worklet ring is ~2 s of interleaved Float32 (`sampleRate*channels*2` ≈ 0.7 MB stereo). 300–500 ms absorbs WS jitter on localhost/LAN and cuts both memory and added latency. | Low — one constant; underflow already degrades to silence, not a glitch. | **Now** for latency; the memory alone isn't worth a dedicated pass. |

## Tier 2 — behaviour changes; land after the feature has soaked

Each of these changes what the user *sees or hears*, or needs a new browser capability. Correct,
but only after Tier 1 and a green E2E gate prove the baseline.

| # | Win | What | Risk | Trigger |
|---|---|---|---|---|
| **O6** | **Adaptive desktop size** | Fixed 1280×720 is rendered, encoded, shipped and decoded even when the pane is a 400 px strip (`scaleViewport` just downscales it client-side — the cost was already paid). RFB `SetDesktopSize` to match the pane (debounced) shrinks render + encode + bytes + decode together. | Medium — apps handle live resize unevenly (a fullscreen GL game may not reflow). Ship behind the fixed-size default; opt in. | A large pane on a weak host, or the deferred "Resize" row in the edge-case table becoming real. |
| **O7** | **Opus audio** | Raw s16le is ~1.4 Mbps. An in-container Opus encode + browser decode drops it ~20×. Already flagged in the audio decision as the WAN upgrade. | Medium — adds an encoder process + a browser decoder (WebCodecs `AudioDecoder` or `libopus` wasm); a decode stall must fall back to silence, not block. | A remote/WAN client where 1.4 Mbps measurably hurts. Not on localhost/LAN. |
| **O8** | **SharedArrayBuffer audio ring + COOP/COEP** | Replace `postMessage` hand-off with a SAB ring the worklet reads directly — removes per-chunk message overhead and GC pressure. COOP/COEP headers it needs *also* unlock wasm threads/`SharedArrayBuffer` for Monaco/LSP wasm later. | Medium — COOP/COEP is app-wide and can break third-party embeds/iframes (incl. the preview pane). Validate the whole app cross-origin isolates cleanly first. | Audio message-passing showing up in a profile, or wanting wasm threads elsewhere. |

## Tier 3 — architectural; only when a concrete need triggers it (defer)

The "cutting-edge" options. Each is the right *ceiling* and the wrong *now* — they discard or
duplicate the working RFB path. Kept here so the research isn't lost, **not** to build early.

| # | Win | What | Why defer |
|---|---|---|---|
| **O9** | **WebCodecs hybrid transport (the headline research)** | Keep the WS `bridge()` and the transport-row seam, but add a `/display/video` row: the container encodes the X framebuffer to H.264/VP8 chunks (ffmpeg/gstreamer capturing `:99`) and the browser decodes with **WebCodecs `VideoDecoder`** → canvas. For high-motion 3D this is far lighter on bytes *and* browser CPU than RFB Tight, **without** WebRTC's ICE/DTLS/SRTP/signalling. Input keeps flowing over the RFB control channel (or a small JSON input row). It is a *hybrid*: WS+seam we already have, modern codec we don't. | Big lift; splits video from input; needs an in-container encoder (compute the software-GL host may not spare). Trigger: a real 60 fps 3D need that Tier-1 tuning (O4/O6) can't satisfy — measured, not assumed. Sits *below* full WebRTC (Stage 3), above RFB. |
| **O10** | **GPU/DRI passthrough** | llvmpipe renders 3D on the CPU — the single biggest container-side compute cost. Mounting `/dev/dri` when the host has a GPU moves it to hardware. | Infra/host-dependent, not a browser-client win, and orthogonal to the transport. Trigger: GPU hosts in the fleet. |
| **O11** | **Full WebRTC A/V mux (Stage 3)** | Already the documented ceiling for broadcast-grade A/V sync. | Explicitly rejected for now above; only a real sync-critical need promotes it. |

## Beyond the display pane (editor-wide, tracked elsewhere)

Same "idle byte" discipline applies to the rest of the client, but these don't belong in a
display plan — noting the shape so they're not forgotten: **file-explorer virtualization** (render
only visible tree nodes; the VFS flat map is fine, the DOM isn't), **Monaco model/worker
disposal** on tab close, and **route-level code-splitting** (env-manager vs editor vs display).
If we want a standing optimisation ledger for the whole editor, that's its own doc — don't
graft it onto this one.
