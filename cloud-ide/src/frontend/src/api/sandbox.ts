// Frontend proxy to the backend sandbox API (/api/v1/sandboxes). apiClient's
// base already ends in /api, so the path is /v1/sandboxes.
import type { SandboxState, SandboxStatus } from '@cloud-ide/shared/types/sandbox';
import type { SessionState } from '@cloud-ide/shared/types/session';
import { apiClient } from '@frontend/lib/apiClient';

// ponytail: no createSandbox() wrapper. POST /v1/sandboxes is the raw "create
// compute" verb and always boots a NEW container — calling it to launch an env is
// what double-provisioned. Everything launches through startSession(). Re-add a
// direct wrapper only if something legitimately needs a second sandbox per env.

export interface SessionResponse {
  sessionId: string;
  sandboxId: string;
  websocketUrl: string;
}

/**
 * Connect to an environment. The backend reuses a warm (RUNNING|PAUSED) sandbox
 * owned by the caller for this env — resuming it if paused — and only cold-boots
 * when there is none. This is the entry point for launching: going through
 * createSandbox instead double-provisions on every click. Also issues the
 * httpOnly `sid` cookie that the /api/fs ownership guard reads.
 */
export const startSession = (environmentId: string) =>
  apiClient.post<SessionResponse>('/v1/sessions', { environmentId });

/** Current state of a sandbox (reconciled with the Rust engine). */
export const getSandboxStatus = (sandboxId: string) =>
  apiClient.get<SandboxStatus>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`);

export interface SandboxSummary {
  sandboxId: string;
  environmentId: string;
  state: SandboxState;
  createdAt: number;
  lastActiveAt: number;
}

/** Every sandbox this user owns (Step 12a). State is the stored value, not a live poll. */
export const listSandboxes = () => apiClient.get<SandboxSummary[]>('/v1/sandboxes');

/**
 * Destroy a sandbox: its container AND its /workspace worktree. Irreversible —
 * callers must confirm. Distinct from ending a session (which frees nothing).
 */
export const deleteSandbox = (sandboxId: string) =>
  apiClient.delete<void>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`);

/** Suspend compute (freezes the container); the workspace survives. Resume to wake. */
export const pauseSandbox = (sandboxId: string) =>
  apiClient.post<void>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}/pause`, {});

/** Wake a paused sandbox back to RUNNING. */
export const resumeSandbox = (sandboxId: string) =>
  apiClient.post<void>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {});

export interface SessionSummary {
  sessionId: string;
  userId: string;
  state: SessionState;
  connectedAt: number;
  lastActiveAt: number;
}

/**
 * Browser attachments to a sandbox, newest first. Many sessions can share one
 * sandbox; ending a session never destroys the sandbox — this is the history that
 * makes that distinction visible.
 */
export const listSandboxSessions = (sandboxId: string) =>
  apiClient.get<SessionSummary[]>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}/sessions`);

/**
 * Poll until the sandbox is RUNNING. Provisioning is async (bootSandbox may
 * return PROVISIONING), and the editor's VFS needs a live workspace to hydrate.
 * Throws on ERROR/STOPPED or if it doesn't come up within `timeoutMs`.
 */
export async function waitForRunning(
  sandboxId: string,
  { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { state } = await getSandboxStatus(sandboxId);
    if (state === 'RUNNING') return;
    if (state === 'ERROR' || state === 'STOPPED') {
      throw new Error(`Sandbox ${sandboxId} entered ${state} while provisioning`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Sandbox ${sandboxId} did not reach RUNNING within ${timeoutMs / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
