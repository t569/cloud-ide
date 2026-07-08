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

export function createSandboxDriver(): ISandboxDriver {
  const base = new RustEngineClient(); // OpenSandbox lifecycle + exec via the Rust kernel
  if (config.SANDBOX_DRIVER === 'alibaba') {
    return new AlibabaSdkDriver(base);
  }
  return base;
}
