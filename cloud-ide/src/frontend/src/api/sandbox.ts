// Frontend proxy to the backend sandbox API (/api/v1/sandboxes). apiClient's
// base already ends in /api, so the path is /v1/sandboxes.
import type { SandboxSpec, SandboxRecord, SandboxStatus } from '@cloud-ide/shared/types/sandbox';
import { apiClient } from '@frontend/lib/apiClient';

/** Provision a sandbox from a built image tag; returns the record (incl. sandboxId). */
export const createSandbox = (spec: SandboxSpec) =>
  apiClient.post<SandboxRecord>('/v1/sandboxes', spec);

/** Current state of a sandbox (reconciled with the Rust engine). */
export const getSandboxStatus = (sandboxId: string) =>
  apiClient.get<SandboxStatus>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`);

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
