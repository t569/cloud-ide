# The Sandbox Network Layer

Egress policy and tenant isolation for sandboxes — provider-agnostic in shape, with
OpenSandbox as the first (and today only) implementation.

## Operator guide: what a sandbox can reach, and how to add to it

A sandbox is **deny-default**: it can reach only the domains on its allow-list; everything
else — the whole internet AND other sandboxes — is blocked. The allow-list is computed per
sandbox in [`policy.ts`](./policy.ts) as the union of three things:

1. **Universal** — every sandbox gets these (`COMMON_ALLOW` in `policy.ts`):
   `github.com`, `codeload.github.com`, `raw.githubusercontent.com`, `objects.githubusercontent.com`.
2. **Per-ecosystem** — added for each language the environment uses (`REGISTRIES` in
   `policy.ts`): e.g. `npm → registry.npmjs.org`, `pip → pypi.org, files.pythonhosted.org`,
   `cargo → crates.io, index.crates.io, static.crates.io`, `go → proxy.golang.org, sum.golang.org`.
   Derived from the env's build-step types and `languageServers`.
3. **Per-environment** — whatever the environment declares in its `allowedDomains` config
   field (`shared/types/env.ts`). Wildcards allowed (`*.acme.io`).

**To add a domain, pick the narrowest scope that fits:**

| You want | Add it to | Code change |
|---|---|---|
| One env to reach one API (`api.stripe.com`) | that environment's `allowedDomains` | none — config only |
| A new language's package registries | `REGISTRIES` in `policy.ts` | yes |
| Every sandbox everywhere to reach it | `COMMON_ALLOW` in `policy.ts` | yes |

**To see a sandbox's effective list today:** read `policy.ts` + the env's `allowedDomains`,
or check the egress sidecar's startup log (`docker logs sandbox-egress-<id>`), which prints
the rules it installed. There is not yet a runtime API or UI for this — see *Roadmap*.

**A blocked domain looks like** a DNS failure inside the sandbox ("Name or service not
known") or a connection timeout — not an obvious "blocked by policy" message. If a build or
app can't reach something it should, the allow-list is the first place to look.

## Why this exists

Every sandbox used to boot onto Docker's default bridge (`172.17.0.x`) with no outbound
policy. Two consequences, both verified live:

- **Cross-tenant injection.** One sandbox could reach another's dev server by raw IP
  (`curl 172.17.0.3:8000` → a neighbour's app). Proven: a sandbox read a secret file out
  of another sandbox's HTTP server.
- **Unrestricted egress.** A sandbox could reach the whole internet and the host.

The fix is one seam that converges both, plus the DNS/doctor reconciliation.

## The contract (provider-agnostic)

Two small types in `@cloud-ide/shared` (`shared/types/sandbox.ts`):

```ts
interface EgressRule       { action: 'allow' | 'deny'; target: string; } // FQDN or *.wildcard
interface NetworkPolicySpec { defaultAction: 'allow' | 'deny'; rules: EgressRule[]; }
```

`defaultAction` is the crux and doubles as the **isolation control**:

- `'deny'` — block everything except `rules`. Because rules are DOMAINS and a neighbour is
  reached by raw IP (no DNS lookup), deny-default leaves east-west traffic with no matching
  rule → dropped. **Isolation is a consequence of deny-default egress, not a second
  mechanism.**
- `'allow'` — permit everything except `rules`. Dev-friendly, but NO isolation.

A sandbox's policy is decided at boot by `defaultNetworkPolicy(env)` (`policy.ts`):
deny-default, allow-list = the package registries the env's toolchain needs (derived from
its build-step types and language servers) + GitHub + any domains the env declares in
`allowedDomains`. Everything else — including other sandboxes — is denied.

## How OpenSandbox implements it

`openSandboxEngine.bootSandbox` maps `NetworkPolicySpec` to the daemon's `networkPolicy`
field. The daemon then, per sandbox:

1. Starts an **egress sidecar** container (`opensandbox/egress`).
2. Puts the sandbox in the sidecar's network namespace (`--network container:<sidecar>`)
   and drops `NET_ADMIN` from the sandbox — only the sidecar keeps it.
3. The sidecar enforces the policy in **`dns+nft` mode**: it intercepts DNS and installs
   nftables rules. Under deny-default, any address that is not an allowed-domain IP —
   every other sandbox included — is dropped.

Endpoints for a policied sandbox come back requiring an `X-Egress-Auth` header; the
gateway carries it via `SandboxEndpoint.headers` (see `types/engine.ts`, and the preview
ingress in `api/PreviewRoutes.ts`).

`mode = "dns+nft"` (not plain `"dns"`) is load-bearing: plain `dns` filters only what a
sandbox *resolves* and cannot stop a raw-IP `curl`, so it does **not** close the injection.
Set in `opensandbox/.sandbox.toml`.

## The capability gate (why sandboxes still boot on a limited kernel)

The `dns+nft` sidecar needs `nf_tables` in the shared kernel. Real Linux has it; the stock
**WSL2 5.10 kernel does not** (nf_tables absent and unloadable), so the sidecar crashes on
startup. Since a policy is attached to *every* boot, an unguarded send would make **every
sandbox fail to boot** on such a host.

So `egressCapability.ts` gates enforcement:

- `SANDBOX_EGRESS=auto` (default) — probe once whether the kernel can run the sidecar (run
  the exact nftables op the sidecar dies on, in a throwaway container). Enforce if it can;
  otherwise **boot without a policy** (no isolation) and log a loud one-time warning.
- `SANDBOX_EGRESS=on` — force enforcement (operator asserts a capable host; skip the probe).
- `SANDBOX_EGRESS=off` — never enforce (single-tenant dev; skip the probe).

Net posture: **isolated where the kernel allows it (production Linux, updated WSL),
gracefully degraded where it doesn't (old-kernel dev host) — never a silent failure either
way.** `npm run doctor` reports which state you're in and how to fix a degraded one
(`wsl --update`).

## DNS: no conflict with the doctor

The doctor's global docker DNS fix and egress **coexist**. In `dns+nft` mode the sidecar
intercepts the sandbox's port-53 traffic via nftables and forwards through its own
whitelisted upstreams (`1.1.1.1`/`8.8.8.8`), so a global resolver never bypasses the
policy — it is only the resolver for no-egress (build-time / degraded) containers.

## Verification status

| Claim | Status |
|---|---|
| Daemon accepts the policy and builds the sidecar | ✅ proven live |
| `dns+nft` sidecar can't run on WSL2 5.10 (no nf_tables) | ✅ proven (sidecar logs + direct probe exit 4) |
| Capability gate: off/on/auto + probe outcome | ✅ unit-tested (`egressCapability.test.ts`) |
| Degraded boot omits the policy (payload identical to pre-egress) | ✅ by construction + equivalence |
| `defaultNetworkPolicy` allow-list derivation | ✅ unit-tested (`policy.test.ts`) |
| **Isolation actually closes the injection** | ✅ **PROVEN live** on kernel 6.18 (see below) |

**Verified end-to-end (2026-07-13, WSL2 kernel 6.18.33.2 after `wsl --update`):** two
sandboxes booted through our API, each got its own egress sidecar. Sandbox A's attempt to
reach sandbox B's HTTP server by raw IP (`172.17.0.3:8000`) **timed out** — both via
`docker exec` and via our gateway `/exec` endpoint, where the secret file was never
received. Before egress this leaked `SECRET-OF-TENANT-B`. The allow-list works both ways:
from A, `github.com` (allowed) returned HTTP 200 while `example.com` (not allowed) was
refused at DNS. So it is a real deny-default policy, not a dead network.

On the old WSL2 5.10 kernel the sidecar can't run (no nf_tables) and the gate degrades to
no isolation — `wsl --update` is the fix, confirmed by this run.

## Roadmap (next slices, not built here)

- **Subdomain ingress + signed preview token.** Host-based `*.localhost` routing so a dev
  server's HMR client targets the gateway correctly, with a `secureAccess`-style signed
  token instead of the session cookie (a per-preview origin won't receive it). This mirrors
  the same modular pattern as this egress seam.
- **Daemon features.** Container snapshots (distinct from our filesystem `toolSnapshot`),
  warm pools (cold-boot latency), metadata PATCH.
- **`credentialProxy` MITM** for injecting secrets into outbound requests.
