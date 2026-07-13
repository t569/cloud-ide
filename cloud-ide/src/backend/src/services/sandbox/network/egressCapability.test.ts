// The capability gate is a safety net: it must NEVER let a host that can't run the
// sidecar hard-fail every boot. These pin the three modes and the probe outcome.
//
// The real docker probe was verified out-of-band on this host: the sidecar's actual
// operation (`iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT`) exits 4 on the
// stock WSL2 5.10 kernel (no nf_tables) and 0 on a capable kernel. Here we mock
// child_process so the gate logic itself is tested deterministically.
import { promisify } from 'node:util';

// The module does `promisify(execFile)`, so mock execFile's promisify.custom directly —
// that is the function promisify returns, sidestepping callback-vs-promise fiddliness.
// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockProbe = jest.fn<Promise<{ stdout: string }>, unknown[]>();
jest.mock('node:child_process', () => {
  const execFile: any = jest.fn();
  execFile[promisify.custom] = (...args: unknown[]) => mockProbe(...args);
  return { execFile };
});

/** Make the probe pass (kernel capable) or fail (missing nf_tables, exit 4). */
function probeResult(ok: boolean) {
  if (ok) mockProbe.mockResolvedValue({ stdout: '' });
  else mockProbe.mockRejectedValue(Object.assign(new Error('iptables failed'), { code: 4 }));
}

/** Fresh import with a chosen SANDBOX_EGRESS mode (the module reads env + caches at load). */
async function load(mode?: string) {
  jest.resetModules();
  mockProbe.mockReset();
  if (mode === undefined) delete process.env.SANDBOX_EGRESS;
  else process.env.SANDBOX_EGRESS = mode;
  return import('./egressCapability');
}

afterAll(() => delete process.env.SANDBOX_EGRESS);

describe('egress capability gate', () => {
  it('off — never enforces, never probes (single-tenant dev)', async () => {
    const m = await load('off');
    probeResult(true); // even if a probe would pass, off wins
    expect(await m.egressEnforceable()).toBe(false);
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('on — always enforces without probing (operator asserts a capable host)', async () => {
    const m = await load('on');
    expect(await m.egressEnforceable()).toBe(true);
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('auto — a failing probe degrades to no enforcement (THE WSL-kernel case)', async () => {
    const m = await load('auto');
    probeResult(false);
    expect(await m.egressEnforceable()).toBe(false);
  });

  it('auto — a passing probe enables enforcement', async () => {
    const m = await load('auto');
    probeResult(true);
    expect(await m.egressEnforceable()).toBe(true);
  });

  it('auto — the probe runs at most once (cached per process)', async () => {
    const m = await load('auto');
    probeResult(false);
    await m.egressEnforceable();
    await m.egressEnforceable();
    await m.egressEnforceable();
    expect(mockProbe).toHaveBeenCalledTimes(1);
  });

  it('defaults to auto when unset', async () => {
    const m = await load(undefined);
    expect(m.egressMode()).toBe('auto');
  });
});
