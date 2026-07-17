// Guards the F3 audio fix: pulseaudio runs as the NON-ROOT sandbox user (uid 1000), and
// refuses an XDG_RUNTIME_DIR it doesn't own. The tap failing is SOFT (the pane just disables
// its speaker), so a regression here is invisible without this check. See display.ts.
import { startAudio, startDisplay } from './display';

// Capture the shell script startAudio/startDisplay hand to exec (single-element argv).
const capture = () => {
  let script = '';
  const exec = async (command: string[]) => {
    script = command[0];
    return { exitCode: 0, stdout: 'OK', stderr: '' } as any;
  };
  return { exec, get: () => script };
};

describe('startAudio — non-root runtime dir', () => {
  it('points XDG_RUNTIME_DIR at a per-uid dir the user owns, not root-owned /tmp', async () => {
    const c = capture();
    await startAudio(c.exec);
    const script = c.get();

    // The bug: `XDG_RUNTIME_DIR=/tmp` (root-owned) → pulseaudio-as-uid-1000 aborts at startup.
    expect(script).not.toMatch(/XDG_RUNTIME_DIR=\$\{XDG_RUNTIME_DIR:-\/tmp\}/);
    // The fix: a per-uid dir, created + locked to 0700 so pulseaudio owns it.
    expect(script).toContain('/tmp/cide-pulse-$(id -u)');
    expect(script).toMatch(/mkdir -p "\$XDG_RUNTIME_DIR"/);
    expect(script).toMatch(/chmod 700 "\$XDG_RUNTIME_DIR"/);
    // Still builds the tap the gateway reads.
    expect(script).toContain('module-simple-protocol-tcp');
    expect(script).toContain('port=4713');
  });
});

describe('startDisplay', () => {
  it('probes the RFB port and reports NO_DISPLAY_STACK when Xvnc is absent', async () => {
    // exit 3 + NO_XVNC is the "not installed" signal display.ts maps to a fixable message.
    const exec = async () => ({ exitCode: 3, stdout: 'NO_XVNC', stderr: '' } as any);
    const res = await startDisplay(exec);
    expect(res).toEqual({ ok: false, code: 'NO_DISPLAY_STACK', detail: expect.any(String) });
  });
});
