// frontend/src/services/exportApi.ts
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { apiClient } from '../../../lib/apiClient';

export const exportEnvironmentConfig = async (config: EnvironmentConfig): Promise<any> => {
  // apiClient.post automatically stringifies the body, attaches the base URL, 
  // sets the Content-Type to JSON, and throws our custom ApiError if it fails.
  return await apiClient.post('/environment/', config);
};