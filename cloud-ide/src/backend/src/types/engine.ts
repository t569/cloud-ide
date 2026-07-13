// backend/src/types/engine.ts

import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
} from '@cloud-ide/shared/types/sandbox';

export interface ExecConnectionInfo {
  baseUrl: string;
  accessToken?: string | null;
}

/**
 * How to reach a service listening on a port INSIDE a sandbox.
 *
 * A URL alone is not enough, which is why this is not a string. The provider decides
 * how a container port is exposed, and it can demand headers with it: the OpenSandbox
 * daemon guards every route with `OPEN-SANDBOX-API-KEY`, and its `Endpoint` schema
 * carries a `headers` field of its own ("headers required when accessing the endpoint" —
 * egress auth on the sidecar port, header-based routing on k8s). We used to return the
 * bare URL and drop all of that, which works only in the one configuration where the
 * daemon needs no key. Anything that proxies to this URL must send these headers.
 */
export interface SandboxEndpoint {
  /** Absolute, host-routable base URL (scheme included). May carry a path prefix. */
  url: string;
  /** Headers that MUST accompany every request to `url`. Possibly empty. */
  headers: Record<string, string>;
}

// THE BRIDGE INTERFACE
export interface RustEngineAPI {
  bootSandbox(spec: SandboxSpec): Promise<SandboxStatus>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  resumeSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo>;
  resolveEndpoint(sandboxId: string, port: number): Promise<SandboxEndpoint>;
}