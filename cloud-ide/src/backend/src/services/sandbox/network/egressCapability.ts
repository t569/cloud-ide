// Can this HOST actually enforce egress? — the capability gate.
//
// Egress isolation is enforced by a per-sandbox sidecar that installs nftables rules
// (dns+nft mode). That needs netfilter modules in the kernel the containers share.
// A real Linux host has them; the stock WSL2 kernel (5.10-microsoft) does NOT — nf_tables
// is absent and unloadable — so the sidecar crashes on startup and the boot 500s.
//
// Because we now attach a policy to EVERY boot, an unguarded send turns that into "no
// sandbox can start on this host". So we probe once: enforce where the kernel allows it,
// degrade (boot without a policy, loudly) where it does not. Isolation is thus a property
// of the host's capability, reported honestly, never a silent failure either way.
//
// Provider-agnostic in shape; the probe happens to use the OpenSandbox egress image
// because it is already pulled and is the most faithful test of the real sidecar.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// SANDBOX_EGRESS: 'auto' (default — probe the kernel), 'on' (operator asserts a capable
// host; skip the probe), 'off' (single-tenant dev — never isolate, never probe).
const RAW_MODE = (process.env.SANDBOX_EGRESS ?? 'auto').toLowerCase();
const EGRESS_IMAGE = process.env.SANDBOX_EGRESS_IMAGE ?? 'opensandbox/egress:v1.0.3';

export type EgressMode = 'auto' | 'on' | 'off';
export function egressMode(): EgressMode {
  return RAW_MODE === 'on' || RAW_MODE === 'off' ? RAW_MODE : 'auto';
}

let cached: Promise<boolean> | undefined;

/**
 * Whether sandboxes should be booted WITH an egress policy on this host. Cached: the
 * answer is a property of the kernel and does not change while the gateway runs.
 */
export function egressEnforceable(): Promise<boolean> {
  const mode = egressMode();
  if (mode === 'on') return Promise.resolve(true);
  if (mode === 'off') return Promise.resolve(false);
  return (cached ??= probe());
}

async function probe(): Promise<boolean> {
  try {
    // Replicate the EXACT operation the sidecar dies on: appending a udp REDIRECT rule to
    // the nat OUTPUT chain (its DNS-intercept rule). Creating a bare chain (`-N`) is too
    // lenient — it succeeds on the old WSL2 kernel while this fails, because it needs the
    // `udp`/`REDIRECT` extensions and a real nat OUTPUT chain that nf_tables provides.
    // `-C ... || -A ...` then clean up; any failure here means the sidecar cannot run.
    await run(
      'docker',
      ['run', '--rm', '--network=none', '--cap-add=NET_ADMIN', '--entrypoint', 'sh',
        EGRESS_IMAGE, '-c',
        'iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports 15353'],
      { timeout: 25_000 },
    );
    console.log('[egress] enforcement available — sandboxes boot isolated (kernel has nftables).');
    return true;
  } catch {
    console.warn(
      '[egress] enforcement UNAVAILABLE on this host — sandboxes boot WITHOUT network isolation.\n' +
      '         The egress sidecar needs nf_tables, which this kernel lacks (typical of the stock\n' +
      '         WSL2 5.10 kernel). Fix: `wsl --update` for a modern kernel, then restart. See\n' +
      '         `npm run doctor`. Set SANDBOX_EGRESS=off to accept this silently (single-tenant dev).',
    );
    return false;
  }
}
