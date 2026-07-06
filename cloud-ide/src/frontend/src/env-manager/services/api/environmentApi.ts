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

export const listEnvironments = () => apiClient.get<SavedEnvironment[]>('/environment/');

export const getEnvironment = (id: string) =>
  apiClient.get<SavedEnvironment>(`/environment/${encodeURIComponent(id)}`);

export const deleteEnvironment = (id: string) =>
  apiClient.delete<{ message: string }>(`/environment/${encodeURIComponent(id)}`);
