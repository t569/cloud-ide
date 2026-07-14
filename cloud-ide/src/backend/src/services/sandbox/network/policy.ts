// The default outbound egress policy for a sandbox — provider-agnostic.
//
// This is the one piece of real logic in the network layer. It turns an environment's
// declared toolchain into the allow-list of domains its sandboxes may reach, under a
// DENY-DEFAULT policy. Deny-default is what closes the cross-tenant injection: a
// neighbouring sandbox is reached by raw IP (172.17.0.x), which matches no domain rule
// and is therefore dropped (enforced by the provider's dns+nft sidecar).
//
// It maps an ENVIRONMENT to a policy, not an OpenSandbox anything — the OpenSandbox
// driver translates the returned NetworkPolicySpec into the daemon's wire format.
import type { EnvironmentConfig, NetworkPolicySpec, EgressRule } from '@cloud-ide/shared';

/**
 * Every known package-registry host, grouped by ecosystem for readability only — ALL of
 * them are allowed for EVERY sandbox (see defaultNetworkPolicy). Gating them per declared
 * ecosystem was the wrong trade: it broke the common case (a node env that never declared
 * an `npm` build step couldn't `npm install`) to deny a node sandbox reach to, say, pypi —
 * which is no risk deny-default doesn't already cover. The isolation that matters (raw-IP
 * reach to a neighbour) stays denied regardless of what's on this list.
 *
 * Kept deliberately specific rather than wildcarded: a broad `*.org` allow-list would
 * defeat the point. Where a provider spreads downloads across a CDN subdomain (pip →
 * pythonhosted, cargo → static/index, node-gyp → nodejs.org) the specific hosts are listed.
 */
const REGISTRIES: Record<string, string[]> = {
  // node / javascript / typescript (nodejs.org: node-gyp headers for native modules)
  npm: ['registry.npmjs.org', 'nodejs.org'],
  // python
  pip: ['pypi.org', 'files.pythonhosted.org'],
  // rust (modern sparse index + downloads)
  cargo: ['crates.io', 'index.crates.io', 'static.crates.io'],
  // go (module proxy + checksum db; most modules also live on github, covered below)
  go: ['proxy.golang.org', 'sum.golang.org'],
  // ruby
  ruby: ['rubygems.org', 'index.rubygems.org'],
  // jvm
  maven: ['repo.maven.apache.org', 'repo1.maven.org'],
  gradle: ['services.gradle.org', 'plugins.gradle.org'],
  // zig
  zig: ['ziglang.org'],
  // system packages (debian + ubuntu default mirrors)
  apt: ['deb.debian.org', 'security.debian.org', 'archive.ubuntu.com', 'security.ubuntu.com', 'ports.ubuntu.com'],
};

/** Flattened once: every registry host, allowed for every sandbox. */
const ALL_REGISTRIES: string[] = Object.values(REGISTRIES).flat();

/**
 * Allowed for EVERY sandbox. GitHub is load-bearing across ecosystems: `go get` pulls
 * modules from it, countless installers `curl` a `raw.githubusercontent.com` script, and
 * users clone repos. Without it a deny-default policy would break the common case.
 */
const COMMON_ALLOW = [
  'github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
];

/**
 * The default deny-default egress policy for a sandbox.
 *
 * Allow-list = every known package registry + the always-on GitHub set + any domains the
 * env explicitly declares (`allowedDomains`). Everything else — including raw-IP reach to
 * other sandboxes — is denied, which is the property that closes cross-tenant injection.
 *
 * Registries are allowed unconditionally (not gated on the env's declared ecosystem):
 * `npm install`, `pip install`, `cargo build`, … work in ANY env without the env having to
 * declare the toolchain, and denying a node sandbox reach to pypi bought no isolation the
 * deny-default doesn't already give. `config` is optional (the raw `POST /v1/sandboxes`
 * verb boots from no environment) and now only contributes its `allowedDomains`.
 */
export function defaultNetworkPolicy(config?: EnvironmentConfig): NetworkPolicySpec {
  const domains = new Set<string>([...COMMON_ALLOW, ...ALL_REGISTRIES]);
  for (const domain of config?.allowedDomains ?? []) {
    const trimmed = domain.trim();
    if (trimmed) domains.add(trimmed);
  }

  const rules: EgressRule[] = [...domains].sort().map((target) => ({ action: 'allow', target }));
  return { defaultAction: 'deny', rules };
}
