// src/frontend/src/services/exportApi.ts
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

// TODO: Move this to a more central API service file if we add more endpoints in the future
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const exportEnvironmentConfig = async (config: EnvironmentConfig): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/environment/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Safely stringify the React Hook Form data
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      // Attempt to parse backend error message, fallback to generic status
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Export failed with status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    // Bubble the error up to the UI
    throw error;
  }
};