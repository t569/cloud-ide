// HTTP client for the OpenSandbox lifecycle daemon + its in-container execd.
//
// Originally a napi Rust addon (src-rust), ported to TS because it was doing no CPU
// work — just async HTTP and SSE, which Node does natively. It is NO LONGER a mirror
// of that crate: the Rust was written against an imagined API (a `status.ip` field and
// `cpuCount`/`memoryMb` limits that the daemon has never had), and its tests mocked
// that same fiction, so they passed while every real boot failed. The shapes below are
// taken from upstream `server/opensandbox_server/api/schema.py`. See
// src/opensandbox/README.md for the full audit before "restoring" anything here.

import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStatus,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { ExecConnectionInfo, RustEngineAPI, SandboxEndpoint } from '../../types/engine';

const EXECD_PORT = 44772;

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * A failure where the request NEVER CONNECTED — undici's `TypeError: fetch
 * failed` with a refused/unreachable syscall code in the cause. Only these are
 * safe for exec to retry: commands are not idempotent, and anything that may
 * have reached execd (an HTTP response, a timeout mid-flight, a reset after
 * connect) may also have RUN, so it must surface, not repeat.
 */
export function isConnectionFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: { code?: string; socket?: { bytesRead?: number } } }).cause;
  const code = cause?.code ?? (err as { code?: string }).code;
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') return true;
  // Cold-boot shape #2: the daemon's port-forward ACCEPTS (the mapping exists)
  // but execd behind it isn't serving yet, so the socket closes with ZERO bytes
  // read (UND_ERR_SOCKET "other side closed"). No response byte ever arrived, so
  // nothing was executed — safe to retry. A close after ANY bytes is not.
  if (code === 'UND_ERR_SOCKET' && cause?.socket?.bytesRead === 0) return true;
  // `fetch failed` with no cause code: undici's generic never-connected shape.
  return err.message === 'fetch failed' && !code;
}

export class OpenSandboxEngine implements RustEngineAPI {
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private readonly execdAccessToken?: string;
  private readonly readTimeoutMs: number;
  // Cold-boot grace for execd (see execCommand): total worst-case wait ≈ retries × delay.
  private readonly execConnectRetries = Number(process.env.EXEC_CONNECT_RETRIES) || 6;
  private readonly execConnectRetryDelayMs = Number(process.env.EXEC_CONNECT_RETRY_DELAY_MS) || 500;

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
    // The daemon reads resourceLimits as free-form Kubernetes quantity strings keyed
    // `cpu` and `memory`. Any other key is accepted by pydantic, then silently dropped
    // by the Docker runtime — which is how this booted uncapped for so long. Note
    // `memory` without a unit means BYTES, so the Mi suffix is load-bearing.
    // Default caps must fit a real dev workload: 512MB OOM-killed cc1 the first
    // time anyone compiled raylib via cgo (`gcc: fatal error: Killed`). 2GB/2cpu
    // is the floor for "a compiler runs here"; per-env `resources` overrides, and
    // operators tune the fleet default via env vars.
    const cpu = spec.resourceLimits?.cpuCount
      ?? (Number(process.env.SANDBOX_DEFAULT_CPU) || 2);
    const memoryMb = Math.round(spec.resourceLimits?.memoryMb
      ?? (Number(process.env.SANDBOX_DEFAULT_MEMORY_MB) || 2048));
    const payload: Record<string, unknown> = {
      // ponytail: no `pullPolicy` and no top-level `exposedPorts` — neither is a field
      // on CreateSandboxRequest. Ports are reached via resolveEndpoint(), not declared.
      image: { uri: spec.imageTag },
      // No TTL. `timeout` is an ABSOLUTE deadline from creation, not an idle timer, so
      // the old 3600 killed sandboxes out from under active users at the 1h mark — and
      // IdleSweeper then saw STOPPED and destroyed the record and its worktree.
      // IdleSweeper owns the lifecycle: it pauses on idle and prunes ghosts. null
      // disables auto-expiry (Docker runtime; a k8s provider may reject a null timeout).
      timeout: null,
      resourceLimits: { cpu: String(cpu), memory: `${memoryMb}Mi` },
      env: spec.envVars ?? {},
      volumes: (spec.volumes ?? []).map(mapVolumeMount),
      entrypoint: ['sleep', 'infinity'],
    };

    // Egress policy → per-sandbox sidecar. Sending this is what makes the daemon put the
    // sandbox in an isolated netns behind a dns+nft filter (drops NET_ADMIN, denies
    // raw-IP east-west under deny-default) — the tenant-isolation fix. The daemon field
    // is `networkPolicy` with `egress` rules (populate_by_name aliases; see
    // server schema.py NetworkPolicy). Dropped for so long that every sandbox booted
    // allow-all with no sidecar. Omitted only when no policy is supplied at all.
    if (spec.networkPolicy) {
      payload.networkPolicy = {
        defaultAction: spec.networkPolicy.defaultAction,
        egress: spec.networkPolicy.rules.map((r) => ({ action: r.action, target: r.target })),
      };
    }

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
   * Ask the daemon how to reach `port` inside the sandbox. It answers in one of TWO
   * ways, and they are not interchangeable — see the two callers below.
   *
   *  - default (`use_server_proxy` off): the host-mapped port of execd's own embedded
   *    proxy, e.g. `127.0.0.1:52544/proxy/<port>`.
   *  - `use_server_proxy=true`: the DAEMON's proxy, e.g.
   *    `127.0.0.1:8080/sandboxes/<id>/proxy/<port>` — a FastAPI route that connects to
   *    the container's own IP and relays both HTTP and WebSocket.
   */
  private async fetchEndpoint(
    sandboxId: string,
    port: number,
    useServerProxy: boolean,
  ): Promise<SandboxEndpoint> {
    const query = useServerProxy ? '?use_server_proxy=true' : '';
    const res = await this.request(
      'GET',
      `${this.apiBaseUrl}/sandboxes/${sandboxId}/endpoints/${port}${query}`,
    );
    if (!res.ok) {
      throw new Error(
        `No endpoint for port ${port} on sandbox ${sandboxId}: ${res.status} ${await res.text()}`,
      );
    }
    const body = await res.json();
    const endpoint = body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      throw new Error(`Daemon returned no endpoint for port ${port} on sandbox ${sandboxId}.`);
    }
    // The daemon can demand headers with the endpoint (egress auth on the sidecar port,
    // header-based routing). They were being dropped; carry them.
    return {
      url: normalizeEndpointUrl(endpoint, port),
      headers: { ...(body.headers ?? {}) },
    };
  }

  /**
   * How the gateway's preview ingress reaches a USER'S service (a dev server on 5173, an
   * API on 8000) inside the sandbox.
   *
   * Deliberately the daemon's server proxy, NOT the default endpoint. The default points
   * at execd's embedded proxy, which forwards execd's own port fine — that is why the
   * terminal works — but HANGS UP on an application port: a real server listening on
   * :8000 answered 200 through the daemon's proxy and dropped the connection through
   * execd's, so every preview 502'd with "socket hang up". The daemon's route also
   * carries WebSockets, which a dev server's hot reload needs.
   *
   * That route is part of the daemon's API, so it sits behind the same API-key
   * middleware as everything else — the key travels with the URL, in `headers`, or a
   * keyed deployment gets 401s the moment it leaves local dev.
   */
  async resolveEndpoint(sandboxId: string, port: number): Promise<SandboxEndpoint> {
    const endpoint = await this.fetchEndpoint(sandboxId, port, true);
    if (this.apiKey) endpoint.headers['OPEN-SANDBOX-API-KEY'] = this.apiKey;
    return endpoint;
  }

  /**
   * How the gateway reaches EXECD (the in-container command daemon).
   *
   * Stays on the DIRECT host-mapped endpoint. execd is what the default endpoint is
   * built for, it demonstrably works, and it keeps the terminal's SSE stream on a
   * straight TCP path to the container instead of relaying it through the daemon's
   * Python proxy for no benefit.
   */
  async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    const { url } = await this.fetchEndpoint(sandboxId, EXECD_PORT, false);
    return { baseUrl: url, accessToken: this.execdAccessToken ?? null };
  }

  async execCommand(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult> {
    // A sandbox is RUNNING the moment its CONTAINER starts, but execd inside it
    // takes a beat to bind its port — the first exec after a cold boot got
    // connection-refused ("fetch failed") and every exec-dependent feature
    // (tool baseline, display start, drift) failed once, right after boot.
    // Retry CONNECTION-level failures here, at the one choke point all execs
    // route through. An HTTP response from execd — any status — is never
    // retried: the daemon answered, so the failure is the command's, not the
    // connection's, and commands are not guaranteed idempotent.
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.execConnectRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.execConnectRetryDelayMs));
      try {
        return await this.execOnce(sandboxId, payload);
      } catch (err) {
        lastErr = err;
        if (!isConnectionFailure(err)) throw err;
      }
    }
    throw lastErr;
  }

  private async execOnce(sandboxId: string, payload: SandboxExecRequest): Promise<SandboxExecResult> {
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

// ---- pure helpers ----

export function normalizeLifecycleBaseUrl(url: string): string {
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

/**
 * Parse execd's response stream. Exported for the test — the wire format is the contract,
 * and this parser silently disagreed with it on all three counts:
 *
 *   {"type":"init","text":"<id>"}
 *   {"type":"stdout","text":"NAME=\"Alpine Linux\""}      <- ONE LINE, newline stripped
 *   {"type":"stderr","text":"cat: can't open '/x'"}
 *   {"type":"error","error":{"ename":"CommandExecError","evalue":"7"}}   <- exit code
 *   {"type":"execution_complete","execution_time":6}                     <- success
 *
 * 1. FRAMING. These are bare JSON lines, not SSE — there is no `data: ` prefix. Requiring
 *    one skipped EVERY event, so `execBuffered` always returned stdout `''` with exitCode
 *    0: "success, no output". That is why a file outside the workspace opened blank, and
 *    why the tool baseline behind env-promotion silently captured nothing.
 * 2. NEWLINES. Each event is one line with its `\n` stripped, so `stdout += text`
 *    reassembled a file as a single run-on line. Re-add the separator.
 * 3. EXIT CODE. Failure arrives as `type: "error"` with the status in `error.evalue`;
 *    there is no `type: "result"`. Nothing ever set exitCode, so every failed command —
 *    a missing file, a directory, a denied read — looked like a clean success.
 *
 * The `data: ` prefix is still tolerated so a future SSE-framed execd doesn't break this.
 */
export function parseExecdStream(body: string): SandboxExecResult {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (const raw of body.split('\n')) {
    const line = (raw.startsWith('data: ') ? raw.slice('data: '.length) : raw).trim();
    if (!line) continue;

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const text = event?.text ?? event?.data ?? '';
    switch (event?.type) {
      case 'stdout':
        stdout += `${text}\n`;
        break;
      case 'stderr':
        stderr += `${text}\n`;
        break;
      case 'error': {
        // `evalue` is the process's exit status, as a string ("1", "7"). A malformed or
        // absent one still has to be a FAILURE — never fall back to 0 here, or an error
        // event reads as success and the caller happily returns empty content.
        const code = Number(event?.error?.evalue);
        exitCode = Number.isInteger(code) && code !== 0 ? code : 1;
        break;
      }
      case 'result':
        exitCode = Number(event?.exitCode ?? event?.code ?? 0) | 0;
        break;
    }
  }
  return { stdout, stderr, exitCode };
}
