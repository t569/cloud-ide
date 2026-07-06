// Frontend proxy to the backend environment database (/api/environment).
// Mirrors the backend EnvironmentRecord for the fields the UI actually reads.
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { apiClient } from '@frontend/lib/apiClient';

export interface SavedEnvironment {
  id: string;
  imageName: string; // '' until built; set to the docker tag after a successful build
  builderConfig?: EnvironmentConfig;
  createdAt: number;
}

export interface SaveResponse {
  message: string;
  environment: SavedEnvironment;
}

export type BuildStatus = 'idle' | 'building' | 'succeeded' | 'failed';
export interface BuildState {
  envId: string;
  status: BuildStatus;
  buildId?: string; // absent for the 'idle' placeholder from GET /:id/status
  imageTag?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export const listEnvironments = () => apiClient.get<SavedEnvironment[]>('/environment/');

export const getEnvironment = (id: string) =>
  apiClient.get<SavedEnvironment>(`/environment/${encodeURIComponent(id)}`);

// Create a NEW environment — the backend mints the id and (if blank) the name.
export const createEnvironment = (config: EnvironmentConfig) =>
  apiClient.post<SaveResponse>('/environment/', config);

// Update the environment currently open in the Architect (identity is immutable).
export const updateEnvironment = (id: string, config: EnvironmentConfig) =>
  apiClient.put<SaveResponse>(`/environment/${encodeURIComponent(id)}`, config);

export const getBuildStatus = (id: string) =>
  apiClient.get<BuildState>(`/environment/${encodeURIComponent(id)}/status`);

// Persistent build history for one environment (newest-first).
export const listBuilds = (id: string) =>
  apiClient.get<BuildState[]>(`/environment/${encodeURIComponent(id)}/builds`);

// Explicitly stop a running build.
export const cancelBuild = (id: string) =>
  apiClient.post<{ message: string }>(`/environment/${encodeURIComponent(id)}/build/cancel`, {});

// Roll back: point :latest at a prior content-addressed image tag.
export const rollbackEnvironment = (id: string, imageTag: string) =>
  apiClient.post<SaveResponse>(`/environment/${encodeURIComponent(id)}/rollback`, { imageTag });

export const deleteEnvironment = (id: string) =>
  apiClient.delete<{ message: string }>(`/environment/${encodeURIComponent(id)}`);
