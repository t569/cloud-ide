// The sandbox virtual display: constants + the idempotent Xvnc starter.
// Lives here (not in the API layer) so BOTH callers can use it without a cycle:
//   - SandboxManager.provision auto-starts it at boot for display-enabled envs
//   - DisplayGateway's POST /display re-runs it on pane open/reconnect (revival)
import type { SandboxExecResult } from '@cloud-ide/shared/types/sandbox';

/** X display number and the RFB port Xvnc binds. Fixed, not per-sandbox — each
 *  sandbox is its own network namespace, so there is no collision to manage. */
export const DISPLAY_NUM = 99;
export const RFB_PORT = 5901;

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
  const script =
    `command -v Xvnc >/dev/null 2>&1 || { echo NO_XVNC; exit 3; }; ` +
    `pgrep -x Xvnc >/dev/null 2>&1 || nohup setsid Xvnc :${DISPLAY_NUM} -rfbport ${RFB_PORT} ` +
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
