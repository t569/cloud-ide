// The sandbox virtual display: constants + the idempotent Xvnc starter.
// Lives here (not in the API layer) so BOTH callers can use it without a cycle:
//   - SandboxManager.provision auto-starts it at boot for display-enabled envs
//   - DisplayGateway's POST /display re-runs it on pane open/reconnect (revival)
import type { SandboxExecResult } from '@cloud-ide/shared/types/sandbox';

/** X display number and the RFB port Xvnc binds. Fixed, not per-sandbox — each
 *  sandbox is its own network namespace, so there is no collision to manage. */
export const DISPLAY_NUM = 99;
export const RFB_PORT = 5901;
/** Raw-PCM tap port (module-simple-protocol-tcp). s16le/44100/stereo — the
 *  format the browser AudioWorklet decodes. Fixed for the same netns reason. */
export const AUDIO_PORT = 4713;
export const AUDIO_RATE = 44100;
export const AUDIO_CHANNELS = 2;

export type DisplayStartResult =
  | { ok: true }
  | { ok: false; code: 'NO_DISPLAY_STACK' | 'START_FAILED'; detail: string };

/**
 * Start Xvnc if it isn't already running, then wait (≤5s) for the RFB port to
 * answer. Idempotent. `setsid` + nohup detach it from the exec session so it
 * survives the exec returning. Distinguishes "not installed" (the env needs the
 * GUI toggle + rebuild) from "failed to start" so callers can offer the right fix.
 */
export async function startDisplay(
  exec: (command: string[]) => Promise<SandboxExecResult>,
): Promise<DisplayStartResult> {
  // Idempotency guards on the RFB PORT, not the process name. TigerVNC's binary runs
  // as `Xtigervnc` (Xvnc is a wrapper script), so `pgrep -x Xvnc` never matched a live
  // server — every call spawned a doomed second Xvnc that failed to bind ${RFB_PORT}
  // and exited. A port probe is name-agnostic and is the thing we actually care about.
  const script =
    `command -v Xvnc >/dev/null 2>&1 || { echo NO_XVNC; exit 3; }; ` +
    `(exec 3<>/dev/tcp/127.0.0.1/${RFB_PORT}) 2>/dev/null || nohup setsid Xvnc :${DISPLAY_NUM} -rfbport ${RFB_PORT} ` +
    `-SecurityTypes None -AlwaysShared -geometry 1280x720 -depth 24 >/tmp/xvnc.log 2>&1 & ` +
    `for i in $(seq 1 25); do (exec 3<>/dev/tcp/127.0.0.1/${RFB_PORT}) 2>/dev/null && { echo OK; exit 0; }; sleep 0.2; done; ` +
    `echo START_TIMEOUT; tail -5 /tmp/xvnc.log 2>/dev/null; exit 4`;

  // ONE element: the engine joins argv with spaces for execd (which takes a
  // single shell string) — multi-element argv would lose the script's quoting.
  const res = await exec([script]);
  if (res.exitCode === 0) return { ok: true };
  if (res.stdout.includes('NO_XVNC')) {
    return {
      ok: false,
      code: 'NO_DISPLAY_STACK',
      detail: 'This environment has no display stack. Enable "GUI display" on the environment and rebuild.',
    };
  }
  return { ok: false, code: 'START_FAILED', detail: res.stdout + res.stderr };
}

/**
 * Start the PCM audio tap if it isn't already up: a PulseAudio daemon, a null
 * sink set as default (headless containers have no device, so apps need a sink
 * to play into), and module-simple-protocol-tcp recording that sink's monitor —
 * a raw s16le stream the gateway bridges to the browser's AudioWorklet.
 *
 * DECOUPLED from startDisplay on purpose: video works with no audio stack, and a
 * missing/failed tap must never fail the display. Idempotent (pgrep + module
 * grep guards); waits (≤5s) for the tap port. `NO_AUDIO` is soft — the pane just
 * disables its speaker toggle.
 */
export async function startAudio(
  exec: (command: string[]) => Promise<SandboxExecResult>,
): Promise<DisplayStartResult> {
  // XDG_RUNTIME_DIR: pulseaudio's default per-user runtime path may not exist in
  // a container; point it at /tmp so the daemon has somewhere to put its socket.
  const script =
    `command -v pulseaudio >/dev/null 2>&1 || { echo NO_PULSE; exit 3; }; ` +
    `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/tmp}; ` +
    `pgrep -x pulseaudio >/dev/null 2>&1 || pulseaudio -D --exit-idle-time=-1 --disable-shm=1 >/tmp/pulse.log 2>&1; ` +
    `for i in $(seq 1 25); do pactl info >/dev/null 2>&1 && break; sleep 0.2; done; ` +
    `pactl list short sinks 2>/dev/null | grep -q '\\bcide\\b' || pactl load-module module-null-sink sink_name=cide sink_properties=device.description=cide >/dev/null; ` +
    `pactl set-default-sink cide 2>/dev/null; ` +
    `pactl list short modules 2>/dev/null | grep -q module-simple-protocol-tcp || ` +
    `pactl load-module module-simple-protocol-tcp record=true source=cide.monitor ` +
    `format=s16le rate=${AUDIO_RATE} channels=${AUDIO_CHANNELS} port=${AUDIO_PORT} listen=127.0.0.1 >/dev/null; ` +
    `for i in $(seq 1 25); do (exec 3<>/dev/tcp/127.0.0.1/${AUDIO_PORT}) 2>/dev/null && { echo OK; exit 0; }; sleep 0.2; done; ` +
    `echo AUDIO_TIMEOUT; tail -5 /tmp/pulse.log 2>/dev/null; exit 4`;

  const res = await exec([script]);
  if (res.exitCode === 0) return { ok: true };
  if (res.stdout.includes('NO_PULSE')) {
    return { ok: false, code: 'NO_DISPLAY_STACK', detail: 'This environment has no audio stack.' };
  }
  return { ok: false, code: 'START_FAILED', detail: res.stdout + res.stderr };
}
