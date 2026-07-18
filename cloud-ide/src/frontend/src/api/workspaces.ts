// Frontend proxy to the workspace management API (/api/v1/workspaces) — the durable,
// compute-independent entity (workspace-entity.md). apiClient's base ends in /api.
import { apiClient } from '@frontend/lib/apiClient';

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  ref: string;
  source: 'blank' | 'git-url' | 'host-folder';
  sourceUrl?: string;
  persistence: 'persistent' | 'ephemeral';
  createdAt: number;
  updatedAt: number;
  lastAttachedSandboxId?: string;
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
