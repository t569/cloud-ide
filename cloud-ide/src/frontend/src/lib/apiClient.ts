// frontend/src/lib/apiClient.ts

// Import the constant you defined in your config file!
import { API_BASE_URL } from '../config/env';

export class ApiError extends Error {
  constructor(public message: string, public status: number, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // endpoint will now look like "/environment/export"
  // API_BASE_URL already contains "/api"
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const config: RequestInit = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      
      if (response.status === 401) {
        console.error("Unauthorized: Redirecting to login...");
      }

      throw new ApiError(
        errorData?.error || `Request failed with status ${response.status}`,
        response.status,
        errorData
      );
    }

    if (response.status === 204) return {} as T;
    return await response.json();

  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`Network failure: ${(error as Error).message}`, 0);
  }
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'GET' }),
  post: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
};