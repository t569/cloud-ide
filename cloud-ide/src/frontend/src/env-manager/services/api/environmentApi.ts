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

export const deleteEnvironment = (id: string) =>
  apiClient.delete<{ message: string }>(`/environment/${encodeURIComponent(id)}`);
