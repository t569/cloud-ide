# Plan: Provider-agnostic Network Layer — Egress Policy + Tenant Isolation

## Context

Three problems, one root, verified live this session:

1. **Cross-tenant injection (proven).** Every sandbox boots onto Docker's default
   bridge (`172.17.0.x`). From sandbox `.2` I read a secret file out of sandbox `.3`'s
   dev server: `CROSS-TENANT HTTP READ: SECRET-OF-TENANT-B`. execd (44772) is safe (binds
   container-localhost), but every user app/dev-server port is reachable by every other
   sandbox. This is east-west traffic on a shared L2 segment.

2. **Egress is unenforced.** `SandboxSpec.networkPolicy` already exists in our types but
   `openSandboxEngine.bootSandbox` **drops it** — it is never sent to the daemon. Every
   sandbox boots allow-all: it can reach the whole internet, the host, and its neighbours.

3. **The doctor conflict.** `npm run doctor --fix` writes a **global**
   `/etc/docker/daemon.json` DNS override. OpenSandbox enforces egress **by being the
   DNS resolver** (sidecar). A global resolver is at odds with sidecar-based DNS policy;
   the two fight over the same `/etc/resolv.conf`.

**Goal:** close the injection hole and enforce egress through ONE provider-agnostic seam,
so a future non-OpenSandbox provider slots in — the stated "backend-agnostic" aim. Document
the whole network architecture (incl. the ingress + daemon-feature roadmap) in a README.

## The architectural decision (and why it is sound)

**Do the network layer first, through a thin modular seam, and let it converge all three
problems.** OpenSandbox's egress model is: send a `networkPolicy` on boot → the daemon
starts a per-sandbox **egress sidecar**, puts the sandbox in the sidecar's network
namespace, and enforces rules. Set the sidecar to `mode = "dns+nft"` with
`defaultAction = "deny"` and:

- **Egress is enforced** (allow-list of domains the build/user needs).
- **The injection hole closes** — nftables denies raw-IP outbound, so `curl 172.17.0.3`
  from a neighbour is dropped. Isolation is a *consequence* of deny-default egress, not a
  second mechanism.
- **The API-key/header path becomes load-bearing** — the sidecar makes the daemon return
  endpoints requiring `X-Egress-Auth`; `SandboxEndpoint.headers` (built last session,
  forward-looking) now carries real weight.

Why network-first over ingress-first or interface-first:
- **Security-critical, and proven.** Ponytail's own rule: never simplify away security.
- **One change, three problems.** Injection + egress + the doctor conflict all resolve
  through the same seam.
- **The seam is validated by two consumers, not speculated.** Egress implements it now;
  the subdomain-ingress work (next slice) mirrors the same pattern. We build the interface
  where a second implementer actually exists, not on spec.

Scope of THIS plan: the **network/egress layer + the architecture README**. The subdomain
ingress + signed preview token (last session's thread) and daemon features (snapshots,
pools, `secureAccess`) are documented as sequenced next-steps in the README, not built here.

## Interface shape (provider-agnostic, minimal)

Refine the already-present-but-unused types in `shared/types/sandbox.ts` to match the real
model, then implement OpenSandbox against them:

```ts
export interface EgressRule { action: 'allow' | 'deny'; target: string; } // FQDN or *.wildcard
export interface NetworkPolicySpec {
  defaultAction: 'allow' | 'deny';   // 'deny' = isolated + allow-list
  rules: EgressRule[];
}
```
(Replaces the current `{ allowOutboundDomains, blockAllOterTraffic }` — the typo'd
version. Its only references are the `shared/index.ts` re-export and the **deprecated**
`src-rust/src/lib.rs` (dead — we no longer build the napi engine, per project memory). No
live consumer, so this is a safe tightening; update the `shared/index.ts` export alongside.)

The seam is **boot-time**, matching how the daemon actually applies policy (sidecar created
at container-create). No speculative `updateEgressPolicy`/`exposePort` interface with one
implementation — the aspirational `ISandboxProvider` block in `shared/types/sandbox.ts` is
NOT wired up; leave it, or trim it to what boot actually needs.

## Changes

- **`shared/types/sandbox.ts`** — refine `NetworkPolicySpec` + add `EgressRule` (above).
- **`backend/src/services/sandbox/network/policy.ts`** (NEW, provider-agnostic) —
  `defaultNetworkPolicy(env): NetworkPolicySpec`. Deny-default; allow-list built from a
  small new `LANGUAGE_REGISTRIES` constant map (language → its registry domains: npm →
  `registry.npmjs.org`, python → `pypi.org`+`files.pythonhosted.org`, rust →
  `crates.io`+`static.crates.io`, go → `proxy.golang.org`+`sum.golang.org`, plus
  `github.com`/`codeload.github.com` for all), keyed off the env's declared languages,
  merged with any domains the environment itself declares. NOTE: `packagemanager_rules.ts`
  and `languageServers.ts` hold *command* rules, not registry domains — this map is new,
  not a reuse. This is the one piece of real logic → gets a `policy.test.ts`.
- **`backend/src/services/sandbox/openSandboxEngine.ts`** — `bootSandbox` maps
  `spec.networkPolicy` → daemon `networkPolicy: { defaultAction, egress: rules }` (the field
  it currently drops). This is the OpenSandbox *implementation* of the contract.
- **`backend/src/services/sandbox/SandboxManager.ts`** — `provision()` attaches
  `defaultNetworkPolicy(env)` to the spec when the caller doesn't supply one.
- **`opensandbox/.sandbox.toml`** — `[egress] mode = "dns+nft"` (default is `"dns"`, which
  does NOT block raw-IP east-west — the mode choice is the whole isolation fix).
- **`opensandbox/boot.js`** — pre-pull the egress image (`opensandbox/egress:v1.0.3`) so a
  policy boot doesn't fail creating the sidecar; surface a clear error if absent.
- **`scripts/doctor.sh`** — reconcile the DNS conflict: detect egress-in-use, verify the
  **sidecar's** upstream DNS resolves (the WSL-broken-resolv.conf class of bug moves from the
  sandbox to the sidecar), and stop recommending a blanket global DNS that would undercut
  DNS-based policy. Also check the egress image is present.
- **`backend/src/services/sandbox/network/README.md`** (NEW) — the "architecturally
  complete" doc the user asked for: the provider-agnostic network contract (egress + ingress),
  how OpenSandbox implements it (sidecar, dns+nft, header auth), the tenant-isolation model,
  the doctor reconciliation, and the sequenced roadmap (subdomain ingress + `secureAccess`
  token; daemon snapshots/pools). Cross-link from `ARCHITECTURE.md` lines 342–344 (the
  EGRESS-POLICY-TO-BE-SOLVED note the user selected).

## Verification (live, end-to-end — not just unit tests)

1. `policy.test.ts` — deny-default, correct allow-list per language, user domains merged.
2. Backend jest + frontend vitest stay green; both typechecks clean.
3. **Re-run the injection probe** (the one that proved the hole): boot two sandboxes with
   the default policy, start a marker server in one, attempt the cross-tenant `172.17.0.x`
   read from the other → must now be **refused** (was `SECRET-OF-TENANT-B`).
4. **Confirm the build path still works** through the deny-default allow-list: `npm install`
   / `pip install` inside a policied sandbox resolves and reaches its registry, and a
   NON-allowed domain is blocked. This is the empirical check for the doctor/DNS
   reconciliation — verify whether the sidecar's nft redirect overrides any global DNS
   (the one subtlety I could not settle by reading alone).
5. Confirm a policied sandbox's preview still works (the sidecar changes the endpoint host
   port + adds `X-Egress-Auth`; `SandboxEndpoint.headers` must carry it — exercised via the
   preview ingress from last session).

## Explicitly out of scope (documented in the README as next slices)

- Subdomain `*.localhost` ingress + signed preview token (browser HMR path).
- Daemon features: container snapshots, warm pools (cold-boot latency), metadata PATCH.
- `credentialProxy` MITM secret injection.
