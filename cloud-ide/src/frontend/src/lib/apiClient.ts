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

/**
 * Guarantees a `csrf-token` cookie exists before a mutating request needs it.
 *
 * The backend mints the cookie on any request, so this normally no-ops — the SPA
 * happens to GET before it POSTs. But a cold load that goes straight to a mutating
 * call (a restored session, a deep link into the editor) has no token yet, and the
 * server rejects it with 403. `GET /api/csrf` exists purely to prime the cookies;
 * nothing was calling it.
 */
async function ensureCsrfToken(): Promise<string> {
  const existing = parseCsrfToken(document.cookie);
  if (existing) return existing;

  // 204, sets `csrf-token` (readable) and `uid` (httpOnly).
  await fetch(`${API_BASE_URL}/csrf`, { credentials: 'include' }).catch(() => {});
  return parseCsrfToken(document.cookie);
}

/**
 * POST that hands back the raw streaming Response (SSE, chunked build logs).
 *
 * `apiClient.post()` can't be used for these: it consumes the body as JSON. But a
 * raw `fetch` silently drops both `credentials: 'include'` and the CSRF header,
 * which the backend rejects with 403 on every mutating method — so the stream
 * callers kept hand-rolling (and forgetting) the auth bits. This is the one place
 * that knows how to authenticate a request; use it, don't re-roll it.
 *
 * `url` is absolute — callers already build it from API_BASE_URL.
 */
export async function postStream(
  url: string,
  opts: { body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'X-CSRF-Token': await ensureCsrfToken() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(url, {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'include', // sends the httpOnly `sid` and readable `csrf-token` cookies
    signal: opts.signal,
  });
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

  // CSRF: attach the double-submit token on state-changing requests only,
  // priming the cookie first if this is the app's very first call.
  if (MUTATING_METHODS.has(method)) {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
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
  /** POST raw bytes (an archive upload). `post` JSON-stringifies, which a File can't survive. */
  postBlob: <T>(endpoint: string, body: Blob, contentType = 'application/zip') =>
    request<T>(endpoint, { method: 'POST', body, headers: { 'Content-Type': contentType } }),
  delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
};