// Pure classification for the Allowed Hosts panel: which domains in the sandbox's
// live egress policy are built-in (registries/GitHub, derived by policy.ts) vs the
// env's own, and which env domains are not yet live (added after boot — the policy
// is applied at container-create, so they take effect on the next restart).
import type { NetworkPolicySpec } from '@cloud-ide/shared/types/sandbox';

export interface DomainGroups {
  /** Allowed by the live policy AND declared on the env — removable. */
  active: string[];
  /** Allowed by the live policy but not env-declared (registries, GitHub) — fixed. */
  builtin: string[];
  /** Env-declared but not in the live policy yet — applies on next restart. */
  pending: string[];
}

export function classifyDomains(
  policy: NetworkPolicySpec | null,
  envDomains: string[],
): DomainGroups {
  const live = (policy?.rules ?? []).filter((r) => r.action === 'allow').map((r) => r.target);
  const declared = new Set(envDomains);
  const liveSet = new Set(live);
  return {
    active: live.filter((d) => declared.has(d)),
    builtin: live.filter((d) => !declared.has(d)),
    pending: envDomains.filter((d) => !liveSet.has(d)),
  };
}
