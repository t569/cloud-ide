// Frontend proxy to the workspace management API (/api/v1/workspaces) — the durable,
// compute-independent entity (workspace-entity.md). apiClient's base ends in /api.
import { apiClient } from '@frontend/lib/apiClient';

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  ref: string;
  source: 'blank' | 'git-url' | 'archive';
  sourceUrl?: string;
  persistence: 'persistent' | 'ephemeral';
  createdAt: number;
  updatedAt: number;
  lastAttachedSandboxId?: string;
  /** Repo-specific PAT set on this workspace (overrides the account token at launch). */
  hasCredential?: boolean;
  credentialHost?: string | null;
}

export interface CreateWorkspaceInput {
  name: string;
  source?: 'blank' | 'git-url';
  sourceUrl?: string;
  persistence?: 'persistent' | 'ephemeral';
}

export const listWorkspaces = () => apiClient.get<Workspace[]>('/v1/workspaces');

export const createWorkspace = (input: CreateWorkspaceInput) =>
  apiClient.post<Workspace>('/v1/workspaces', input);

export const deleteWorkspace = (id: string) =>
  apiClient.delete<void>(`/v1/workspaces/${encodeURIComponent(id)}`);

/**
 * Upload a .zip of a project folder as this workspace's source. Sent as raw bytes, not
 * multipart — the server unpacks it and `git init`s it, then clones it at launch like any
 * other remote. `files` is how many were written.
 */
export const uploadWorkspaceArchive = (id: string, archive: File) =>
  apiClient.postBlob<Workspace & { files: number }>(
    `/v1/workspaces/${encodeURIComponent(id)}/archive`,
    archive,
  );

// Repo-specific PAT: overrides the account token when THIS workspace launches. Stored
// encrypted server-side; never returned to the browser (list only reports has/host).
export const setWorkspaceCredential = (id: string, token: string, host?: string) =>
  apiClient.put<void>(`/v1/workspaces/${encodeURIComponent(id)}/credential`, host ? { token, host } : { token });

export const clearWorkspaceCredential = (id: string) =>
  apiClient.delete<void>(`/v1/workspaces/${encodeURIComponent(id)}/credential`);
