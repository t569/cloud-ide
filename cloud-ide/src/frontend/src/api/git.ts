// Frontend proxy to the backend git API (git-integration.md). Sandbox-scoped ops live
// under /v1/sandboxes/:id/git; the PAT credential is user-scoped at /v1/git/credential.
// apiClient's base already ends in /api, so paths start at /v1.
import { apiClient } from '@frontend/lib/apiClient';

const base = (sandboxId: string) => `/v1/sandboxes/${encodeURIComponent(sandboxId)}/git`;

export interface GitStatusEntry {
  /** Two-char porcelain XY code (' M', 'A ', '??', 'R '…). */
  status: string;
  path: string;
}
export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export const getGitStatus = (sandboxId: string) =>
  apiClient.get<{ entries: GitStatusEntry[] }>(`${base(sandboxId)}/status`);

export const getGitBranch = (sandboxId: string) =>
  apiClient.get<{ branch: string }>(`${base(sandboxId)}/branch`);

export const getGitLog = (sandboxId: string, limit = 50) =>
  apiClient.get<{ commits: GitLogEntry[] }>(`${base(sandboxId)}/log?limit=${limit}`);

export const getGitDiff = (sandboxId: string, path?: string) =>
  apiClient.get<{ diff: string }>(
    `${base(sandboxId)}/diff${path ? `?path=${encodeURIComponent(path)}` : ''}`,
  );

/** Stage paths, or everything when omitted. */
export const gitStage = (sandboxId: string, paths?: string[]) =>
  apiClient.post<void>(`${base(sandboxId)}/stage`, paths ? { paths } : {});

export const gitCommit = (sandboxId: string, message: string, author?: { name: string; email: string }) =>
  apiClient.post<void>(`${base(sandboxId)}/commit`, author ? { message, author } : { message });

export const gitPush = (sandboxId: string) => apiClient.post<void>(`${base(sandboxId)}/push`, {});
export const gitPull = (sandboxId: string) => apiClient.post<void>(`${base(sandboxId)}/pull`, {});

// ── User-scoped GitHub PAT ───────────────────────────────────────────────────
export interface GitCredentialState {
  configured: boolean;
  host: string | null;
}
export const getGitCredential = () => apiClient.get<GitCredentialState>('/v1/git/credential');
export const setGitCredential = (token: string, host?: string) =>
  apiClient.put<void>('/v1/git/credential', host ? { token, host } : { token });
export const clearGitCredential = () => apiClient.delete<void>('/v1/git/credential');
