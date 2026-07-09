// HTTP client for the OpenSandbox lifecycle daemon + its in-container execd.
//
// Originally a napi Rust addon (src-rust), ported to TS because it was doing no CPU
// work — just async HTTP and SSE, which Node does natively. It is NO LONGER a mirror
// of that crate: the Rust was written against an imagined API (notably a `status.ip`
// field the daemon has never had), and its tests mocked that same fiction, so they
// passed while every real boot failed. The shapes below are taken from upstream
// `server/opensandbox_server/api/schema.py`. See src/opensandbox/README.md for the
// full audit before "restoring" anything here.

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
    if (!res.ok) throw new Error(`Engine rejected boot: ${res.status} ${await res.text()}`);

    return mapStatus(await res.json(), undefined);
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const res = await this.request('GET', `${this.apiBaseUrl}/sandboxes/${sandboxId}`);
    if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);

    return mapStatus(await res.json(), sandboxId);
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
    return res.ok || res.status === 404;
  }

  /**
   * The only way to reach a port inside a sandbox. The daemon returns a host-routable
   * URL (on Docker Desktop, a loopback proxy like 127.0.0.1:45792/proxy/44772) — it
   * never returns a container IP, so there is no fallback to route to. If the daemon
   * can't resolve the port, nothing else can.
   */
  async resolveEndpoint(sandboxId: string, port: number): Promise<string> {
    const res = await this.request(
      'GET',
      `${this.apiBaseUrl}/sandboxes/${sandboxId}/endpoints/${port}`,
    );
    if (!res.ok) {
      throw new Error(
        `No endpoint for port ${port} on sandbox ${sandboxId}: ${res.status} ${await res.text()}`,
      );
    }
    const endpoint = (await res.json())?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      throw new Error(`Daemon returned no endpoint for port ${port} on sandbox ${sandboxId}.`);
    }
    return normalizeEndpointUrl(endpoint, port);
  }

  async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    const baseUrl = await this.resolveEndpoint(sandboxId, EXECD_PORT);
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
}

// ---- pure helpers (mirror opensandbox.rs free functions) ----

function normalizeLifecycleBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * The daemon's `endpoint` is often scheme-less (`endpoint.host/sandboxes/x/port/8080`)
 * and, on Docker Desktop, a loopback proxy path (`127.0.0.1:45792/proxy/44772`). If it
 * already carries a port or a path it is fully qualified — leave it. Only a bare host
 * gets `port` appended.
 */
export function normalizeEndpointUrl(endpoint: string, port: number): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  const withoutScheme = withScheme.replace(/^https?:\/\//, '');
  if (withoutScheme.includes(':') || withoutScheme.includes('/')) return withScheme;
  return `${withScheme}:${port}`;
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

// The daemon's SandboxState, lowercased. The transitional states matter: `Resuming`
// used to fall through to ERROR, which broke wake-on-demand, and `Terminated` did the
// same, which broke IdleSweeper's reconciliation of vanished containers.
const STATES: Record<string, SandboxStatus['state']> = {
  pending: 'PROVISIONING',
  provisioning: 'PROVISIONING',
  resuming: 'PROVISIONING', // coming up; not yet resumable, so never report PAUSED
  running: 'RUNNING',
  pausing: 'PAUSED',
  paused: 'PAUSED',
  stopping: 'STOPPED',
  stopped: 'STOPPED',
  terminated: 'STOPPED',
  failed: 'ERROR',
};

function mapStatus(data: any, fallbackId: string | undefined): SandboxStatus {
  // `status.state` — there is no `status.phase`, and no `status.ip` at all.
  const raw = String(data?.status?.state ?? '').toLowerCase();

  return {
    sandboxId: data?.id ?? fallbackId ?? '',
    state: STATES[raw] ?? 'ERROR',
    execdPort: EXECD_PORT,
    message: data?.status?.message ?? data?.status?.reason ?? 'OpenSandbox status resolved',
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
