#!/usr/bin/env sh
# npm run doctor  [--fix]
#
# Checks the HOST things that break this stack in ways the app cannot report honestly.
# Run it before debugging a build — it takes five seconds and rules out the class of
# failure that costs an afternoon.
#
# ponytail: checks only what has actually bitten us. Every speculative check is a line
# someone has to maintain and a false alarm someone has to chase.
set -u

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

RED=$(printf '\033[31m'); GRN=$(printf '\033[32m'); YLW=$(printf '\033[33m'); OFF=$(printf '\033[0m')
FAILED=0

pass() { echo "  ${GRN}ok${OFF}    $1"; }
fail() { echo "  ${RED}FAIL${OFF}  $1"; FAILED=1; }
info() { echo "        $1"; }

echo ""
echo "cloud-ide doctor"
echo ""

# ---------------------------------------------------------------- docker is there
if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not on PATH"
  info "The builder, the sandbox driver and the terminal all shell out to it."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  fail "docker is installed but the daemon is not responding"
  info "Start it:  sudo service docker start"
  exit 1
fi
pass "docker daemon is up ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"

# ---------------------------------------------------------------- container DNS
# THE ONE THAT COSTS AN AFTERNOON. On WSL, docker copies /etc/resolv.conf into every
# container; it points at WSL's Windows-side DNS proxy, which is unreachable from a
# container's network namespace. Every package manager then fails in its own dialect and
# NONE of them say "DNS": pip reports "no matching distribution" (reads like a version
# problem), npm says EAI_AGAIN, cargo says "could not resolve host", go says "lookup
# proxy.golang.org". One cause, four red herrings.
DNS_IMAGE=alpine:3.20
docker image inspect "$DNS_IMAGE" >/dev/null 2>&1 || docker pull -q "$DNS_IMAGE" >/dev/null 2>&1

if docker run --rm "$DNS_IMAGE" sh -c 'getent hosts pypi.org' >/dev/null 2>&1; then
  pass "containers can resolve hostnames"
else
  fail "containers cannot resolve ANY hostname"
  info "Every pip/npm/cargo/go install inside a build will fail, each with a different"
  info "and misleading error. This is not a versioning problem."

  # Confirm an explicit resolver actually fixes it before telling anyone to write config.
  if docker run --rm --dns 1.1.1.1 "$DNS_IMAGE" sh -c 'getent hosts pypi.org' >/dev/null 2>&1; then
    info "An explicit resolver works, so the daemon just needs to be told to use one."
    if [ "$FIX" -eq 1 ]; then
      echo ""
      echo "  ${YLW}applying fix${OFF} (needs sudo) — writing /etc/docker/daemon.json"
      # Merge-safe enough for the common case: refuse to clobber an existing config, since
      # it may carry registry mirrors or storage options we know nothing about.
      if [ -f /etc/docker/daemon.json ]; then
        fail "/etc/docker/daemon.json already exists — not overwriting it"
        info "Add this key by hand:  \"dns\": [\"1.1.1.1\", \"8.8.8.8\"]"
      else
        sudo mkdir -p /etc/docker &&
          echo '{ "dns": ["1.1.1.1", "8.8.8.8"] }' | sudo tee /etc/docker/daemon.json >/dev/null &&
          sudo service docker restart &&
          info "daemon restarted — re-run 'npm run doctor' to confirm"
      fi
    else
      info "Fix it:  npm run doctor -- --fix        (writes /etc/docker/daemon.json, needs sudo)"
      info "Or by hand:"
      info "  echo '{\"dns\": [\"1.1.1.1\", \"8.8.8.8\"]}' | sudo tee /etc/docker/daemon.json"
      info "  sudo service docker restart"
    fi
  else
    info "Even an explicit resolver failed — the host itself has no route out (VPN? firewall?)."
  fi
fi

# ---------------------------------------------------------------- buildkit
# The pipeline emits `RUN --mount=type=cache,...`, which is a BuildKit-only syntax. Without
# BuildKit the Dockerfile is a parse error, not a slow build.
if docker buildx version >/dev/null 2>&1; then
  pass "buildx/BuildKit available (the pipeline emits RUN --mount=type=cache)"
else
  fail "buildx is missing — the generated Dockerfile's cache mounts will not parse"
  info "Install docker-buildx-plugin, or drop --use-buildkit from the assembler flags."
fi

# ---------------------------------------------------------------- egress isolation
# Sandboxes boot with a deny-default egress policy for tenant isolation, enforced by a
# per-sandbox sidecar that installs nftables rules. That needs nf_tables in the shared
# kernel. A real Linux host has it; the stock WSL2 5.10 kernel does NOT — nf_tables is
# absent and unloadable — so the sidecar can't start there. This is NOT fatal: the gateway
# probes for it (SANDBOX_EGRESS=auto) and boots WITHOUT a policy when it's missing, so
# sandboxes still run — just without cross-tenant isolation. Hence a warning, not a fail.
EGRESS_IMAGE=$(sed -n 's/^[[:space:]]*image[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' opensandbox/.sandbox.toml 2>/dev/null | head -1)
: "${EGRESS_IMAGE:=opensandbox/egress:v1.0.3}"
if docker image inspect "$EGRESS_IMAGE" >/dev/null 2>&1; then
  # The exact op the sidecar dies on: a udp REDIRECT rule on the nat OUTPUT chain. A bare
  # chain create is too lenient (it passes on the broken kernel), so we replicate the real one.
  if docker run --rm --network=none --cap-add=NET_ADMIN --entrypoint sh "$EGRESS_IMAGE" \
       -c 'iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports 15353' >/dev/null 2>&1; then
    pass "egress isolation enforceable (kernel has nftables) — sandboxes boot isolated"
  else
    info "${YLW}egress isolation UNAVAILABLE on this kernel${OFF} — sandboxes boot WITHOUT tenant isolation."
    info "  The sidecar needs nf_tables; this kernel lacks it ($(uname -r 2>/dev/null))."
    info "  Fix:  wsl --update   (modern kernel), then restart WSL and re-run this."
    info "  Not fatal — SANDBOX_EGRESS=auto degrades gracefully; set =off to silence the warning."
  fi
else
  info "egress sidecar image not pulled yet ($EGRESS_IMAGE) — capability is checked at first boot."
fi
# NOTE on the DNS check above vs egress: they COEXIST, no conflict. In dns+nft mode the
# sidecar intercepts the sandbox's port-53 traffic via nftables and forwards through its
# own whitelisted upstreams (1.1.1.1/8.8.8.8), so a global docker DNS never bypasses the
# policy — it is only the resolver for no-egress (build-time / degraded) containers.

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "${GRN}All clear.${OFF}"
else
  echo "${RED}Some checks failed — fix them before debugging a build.${OFF}"
fi
echo ""
exit "$FAILED"
