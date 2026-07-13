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
 * Package-registry domains keyed by an ECOSYSTEM TOKEN — a build-step type (`npm`,
 * `pip`, …) OR an editor language id (`python`, `rust`, …), so an env is covered whether
 * it declares the registry through its build steps or its language servers.
 *
 * Kept deliberately specific rather than wildcarded: a broad `*.org` allow-list would
 * defeat the point. Where a provider genuinely spreads downloads across a CDN subdomain
 * (pip → pythonhosted, cargo → static/index) the specific hosts are listed.
 */
const REGISTRIES: Record<string, string[]> = {
  // node / javascript / typescript
  npm: ['registry.npmjs.org'],
  javascript: ['registry.npmjs.org'],
  typescript: ['registry.npmjs.org'],
  // python
  pip: ['pypi.org', 'files.pythonhosted.org'],
  python: ['pypi.org', 'files.pythonhosted.org'],
  // rust (modern sparse index + downloads)
  cargo: ['crates.io', 'index.crates.io', 'static.crates.io'],
  rust: ['crates.io', 'index.crates.io', 'static.crates.io'],
  // go (module proxy + checksum db; most modules also live on github, covered below)
  go: ['proxy.golang.org', 'sum.golang.org'],
  golang: ['proxy.golang.org', 'sum.golang.org'],
  // ruby
  ruby: ['rubygems.org', 'index.rubygems.org'],
  // jvm
  maven: ['repo.maven.apache.org', 'repo1.maven.org'],
  gradle: ['services.gradle.org', 'plugins.gradle.org', 'repo.maven.apache.org'],
  // zig
  zig: ['ziglang.org'],
  // system packages (debian + ubuntu default mirrors)
  apt: ['deb.debian.org', 'security.debian.org', 'archive.ubuntu.com', 'security.ubuntu.com', 'ports.ubuntu.com'],
};

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

/** Collapse a config down to its distinct ecosystem tokens (build-step types + language ids). */
function ecosystemTokens(config?: EnvironmentConfig): Set<string> {
  const tokens = new Set<string>();
  for (const step of config?.buildSteps ?? []) tokens.add(step.type);
  for (const lang of config?.languageServers ?? []) tokens.add(lang);
  return tokens;
}

/**
 * The default deny-default egress policy for an environment's sandboxes.
 *
 * Allow-list = the registries for every ecosystem the env touches, + the always-on
 * GitHub set, + any domains the env explicitly declares (`allowedDomains`). Everything
 * else — including raw-IP reach to other sandboxes — is denied.
 *
 * `config` is optional: the raw `POST /v1/sandboxes` verb boots from no environment, and
 * gets the safe minimum (GitHub only). It never gets allow-default — an unknown workload
 * is exactly the one that should not reach its neighbours.
 */
export function defaultNetworkPolicy(config?: EnvironmentConfig): NetworkPolicySpec {
  const domains = new Set<string>(COMMON_ALLOW);
  for (const token of ecosystemTokens(config)) {
    for (const domain of REGISTRIES[token] ?? []) domains.add(domain);
  }
  for (const domain of config?.allowedDomains ?? []) {
    const trimmed = domain.trim();
    if (trimmed) domains.add(trimmed);
  }

  const rules: EgressRule[] = [...domains].sort().map((target) => ({ action: 'allow', target }));
  return { defaultAction: 'deny', rules };
}
