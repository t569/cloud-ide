// frontend/src/lib/apiClient.ts

// Import the constant you defined in your config file!
import { API_BASE_URL } from '../config/env';

export class ApiError extends Error {
  constructor(public message: string, public status: number, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads the CSRF token from a cookie string (double-submit cookie pattern).
 * The backend sets a non-httpOnly `csrf-token` cookie; we echo it back in the
 * X-CSRF-Token header so the server can confirm the request came from our app
 * and not a cross-site forgery. Pure/exported so it is unit-testable.
 */
export function parseCsrfToken(cookieString: string): string {
  const match = cookieString.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // endpoint will now look like "/environment/export"
  // API_BASE_URL already contains "/api"
  const url = `${API_BASE_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // CSRF: attach the double-submit token on state-changing requests only.
  if (MUTATING_METHODS.has(method)) {
    headers['X-CSRF-Token'] = parseCsrfToken(document.cookie);
  }

  const config: RequestInit = {
    ...options,
    headers,
    // Send the httpOnly session cookie even to a cross-origin backend
    // (Vite :5173 -> API :3000). Backend must set CORS allow-credentials.
    credentials: 'include',
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      
      if (response.status === 401) {
        console.error("Unauthorized: Redirecting to login...");
      }

      // Surface the server's `details` (the actual reason) — routes return
      // { error: '<generic wrapper>', details: '<why>' }, and showing only
      // `error` is why failures looked reasonless.
      const base = errorData?.error || `Request failed with status ${response.status}`;
      throw new ApiError(
        errorData?.details ? `${base}: ${errorData.details}` : base,
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