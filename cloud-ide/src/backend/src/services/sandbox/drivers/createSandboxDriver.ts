// backend/src/services/sandbox/drivers/createSandboxDriver.ts
//
// Selects the active sandbox driver from config.SANDBOX_DRIVER (mirrors the
// DOCKER_BUILDER pattern). Default 'opensandbox' = the Rust-kernel driver
// (exec-only, no behavior change). 'alibaba' composes the AlibabaSdkDriver over
// it to add an interactive PTY — see AlibabaSdkDriver (unverified scaffold).
import { config } from '../../../config/env';
import { ISandboxDriver } from './ISandboxDriver';
import { RustEngineClient } from '../rustClient';
import { AlibabaSdkDriver } from './AlibabaSdkDriver';
import { DockerPtyDriver } from './DockerPtyDriver';
import { WasmDriver } from './wasm/WasmDriver';

export function createSandboxDriver(): ISandboxDriver {
  // 'wasm' is the cheap DEPLOYMENT tier (docs/plans/wasm-runtime.md): no Docker daemon, no
  // nftables, no kernel requirements — which is what makes hosting that forbids
  // Docker-in-Docker viable at all. Returned standalone, not composed over the Rust engine:
  // it replaces the runtime rather than adding to it, and there is no daemon to talk to.
  if (config.SANDBOX_DRIVER === 'wasm') {
    return new WasmDriver();
  }

  const base = new RustEngineClient(); // OpenSandbox lifecycle + exec via the Rust kernel
  if (config.SANDBOX_DRIVER === 'alibaba') {
    return new AlibabaSdkDriver(base);
  }
  // Default: add an interactive PTY over the base via `docker exec -it` (node-pty).
  // The containers are local docker (WSL), so this Just Works here; it self-downgrades
  // to exec-only (capabilities().pty=false) if node-pty isn't installed.
  return new DockerPtyDriver(base);
}
