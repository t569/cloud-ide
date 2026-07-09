// TypeScript port of the Rust napi engine (src-rust). The engine was never doing
// CPU work — it's an HTTP client to the OpenSandbox daemon plus an in-memory IP
// table. Node does async HTTP + SSE natively, so this is the same behavior with no
// FFI boundary, no toolchain, and no "Module did not self-register". The Rust crate
// is kept, deprecated, as the reference for this logic (see src-rust/README).
//
// Behavior is a 1:1 mirror of src-rust/src/{lib,engine/opensandbox}.rs.

import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo, RustEngineAPI } from '../../types/engine';

const EXECD_PORT = 44772;

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export class OpenSandboxEngine implements RustEngineAPI {
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private readonly execdAccessToken?: string;
  private readonly readTimeoutMs: number;

  // sandboxId -> internal IP. Mirrors the Rust ACTIVE_SANDBOXES DashMap: avoids
  // re-querying the daemon for the routing IP on every exec.
  private readonly activeSandboxes = new Map<string, string>();

  constructor() {
    const engineType = process.env.ENGINE_TYPE ?? 'opensandbox';
    if (engineType !== 'opensandbox') {
      throw new Error(`Unknown ENGINE_TYPE specified in environment: ${engineType}`);
    }
    this.apiBaseUrl = normalizeLifecycleBaseUrl(
      process.env.OPENSANDBOX_API_URL ?? 'http://127.0.0.1:8080',
    );
    this.apiKey = nonEmpty(process.env.OPENSANDBOX_API_KEY);
    this.execdAccessToken = nonEmpty(process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN);
    // ponytail: fetch has no separate connect timeout; RUST_READ_TIMEOUT covers the
    // whole request. Split it out only if slow-connect vs slow-body ever need to differ.
    this.readTimeoutMs = (Number(process.env.RUST_READ_TIMEOUT) || 120) * 1000;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['OPEN-SANDBOX-API-KEY'] = this.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.readTimeoutMs),
    });
  }

  async bootSandbox(spec: SandboxSpec): Promise<SandboxStatus> {
    const cpu = spec.resourceLimits?.cpuCount ?? 1;
    const mem = spec.resourceLimits?.memoryMb ?? 512;
    const payload: Record<string, unknown> = {
      image: { uri: spec.imageTag, pullPolicy: 'IfNotPresent' },
      timeout: 3600,
      resourceLimits: { cpuCount: String(cpu), memoryMb: String(mem) },
      env: spec.envVars ?? {},
      volumes: (spec.volumes ?? []).map(mapVolumeMount),
      entrypoint: ['sleep', 'infinity'],
    };
    if (spec.exposedPorts) payload.exposedPorts = spec.exposedPorts;

    const res = await this.request('POST', `${this.apiBaseUrl}/sandboxes`, payload);
    if (!res.ok) throw new Error(`Engine rejected boot: ${res.status}`);

    const status = mapStatus(await res.json(), undefined);
    if (status.ipAddress) this.activeSandboxes.set(status.sandboxId, status.ipAddress);
    return status;
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const res = await this.request('GET', `${this.apiBaseUrl}/sandboxes/${sandboxId}`);
    if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);

    const status = mapStatus(await res.json(), sandboxId);
    if (status.ipAddress) this.activeSandboxes.set(status.sandboxId, status.ipAddress);
    return status;
  }

  async pauseSandbox(sandboxId: string): Promise<boolean> {
    const res = await this.request('POST', `${this.apiBaseUrl}/sandboxes/${sandboxId}/pause`);
    return res.ok;
  }

  async resumeSandbox(sandboxId: string): Promise<boolean> {
    const res = await this.request('POST', `${this.apiBaseUrl}/sandboxes/${sandboxId}/resume`);
    return res.ok;
  }

  async destroySandbox(sandboxId: string): Promise<boolean> {
    const res = await this.request('DELETE', `${this.apiBaseUrl}/sandboxes/${sandboxId}`);
    const success = res.ok || res.status === 404;
    if (success) this.activeSandboxes.delete(sandboxId);
    return success;
  }

  getSandboxIp(sandboxId: string): string | null {
    return this.activeSandboxes.get(sandboxId) ?? null;
  }

  async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    const baseUrl = await this.resolveExecEndpoint(sandboxId);
    return { baseUrl, accessToken: this.execdAccessToken ?? null };
  }

  async execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult> {
    const connection = await this.resolveExecConnection(sandboxId);
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    };
    if (connection.accessToken) headers['X-EXECD-ACCESS-TOKEN'] = connection.accessToken;

    const res = await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: payload.command.join(' '), // Go execd wants a single string, not an array
        cwd: payload.cwd ?? '/workspace',
        env: payload.env ?? {},
      }),
      signal: AbortSignal.timeout(this.readTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Execd daemon failed with status ${res.status}: ${await res.text()}`);
    }
    return parseExecdStream(await res.text());
  }

  private async resolveExecEndpoint(sandboxId: string): Promise<string> {
    const res = await this.request(
      'GET',
      `${this.apiBaseUrl}/sandboxes/${sandboxId}/endpoints/${EXECD_PORT}`,
    );
    if (res.ok) {
      const endpoint = extractEndpoint(await res.json());
      if (endpoint) return normalizeExecdBaseUrl(endpoint);
    }
    // Fallback: fetch fresh status and route to its IP directly.
    const status = await this.getSandboxStatus(sandboxId);
    if (status.ipAddress) return `http://${status.ipAddress}:${EXECD_PORT}`;
    throw new Error('Unable to resolve exec endpoint for sandbox');
  }
}

// ---- pure helpers (mirror opensandbox.rs free functions) ----

function normalizeLifecycleBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Docker-on-Windows can't route to container IPs (10.0.x.x); the daemon returns a
 * local proxy like 127.0.0.1:45792/proxy/44772. If the endpoint already carries a
 * port or a path it's fully qualified — leave it. Only a bare IP gets the port.
 */
function normalizeExecdBaseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  const withoutScheme = withScheme.replace(/^https?:\/\//, '');
  if (withoutScheme.includes(':') || withoutScheme.includes('/')) return withScheme;
  return `${withScheme}:${EXECD_PORT}`;
}

function extractEndpoint(data: any): string | undefined {
  return data?.endpoint ?? data?.url ?? data?.address ?? undefined;
}

function mapVolumeMount(volume: VolumeMount): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: volume.name,
    mountPath: volume.mountPath,
    readOnly: volume.readOnly ?? false,
  };
  if (volume.hostPath) payload.host = { path: volume.hostPath };
  if (volume.subPath) payload.subPath = volume.subPath;
  return payload;
}

function mapStatus(data: any, fallbackId: string | undefined): SandboxStatus {
  const raw = String(data?.status?.phase ?? data?.status?.state ?? 'UNKNOWN');
  const STATES: Record<string, SandboxStatus['state']> = {
    Running: 'RUNNING',
    RUNNING: 'RUNNING',
    Pending: 'PROVISIONING',
    PENDING: 'PROVISIONING',
    Provisioning: 'PROVISIONING',
    PROVISIONING: 'PROVISIONING',
    Paused: 'PAUSED',
    PAUSED: 'PAUSED',
    Stopped: 'STOPPED',
    STOPPED: 'STOPPED',
  };
  const state = STATES[raw] ?? 'ERROR';

  return {
    sandboxId: data?.id ?? fallbackId ?? '',
    state,
    ipAddress: data?.status?.ip ?? undefined,
    execdPort: EXECD_PORT,
    message: data?.status?.message ?? 'OpenSandbox status resolved',
  };
}

function parseExecdStream(body: string): SandboxExecResult {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let event: any;
    try {
      event = JSON.parse(line.slice('data: '.length));
    } catch {
      continue;
    }
    const text = event?.text ?? event?.data ?? '';
    switch (event?.type) {
      case 'stdout':
        stdout += text;
        break;
      case 'stderr':
        stderr += text;
        break;
      case 'result':
        exitCode = Number(event?.exitCode ?? event?.code ?? 0) | 0;
        break;
    }
  }
  return { stdout, stderr, exitCode };
}
