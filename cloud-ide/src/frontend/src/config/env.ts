// frontend/src/config/env.ts

// this file has all our env data

// The 'as any' forces TypeScript to stop inspecting import.meta
const BACKEND_HOST = (import.meta as any).env.VITE_BACKEND_HOST || 'localhost:3000';

// Safely check if 'window' exists before checking the protocol
const IS_SECURE = typeof window !== 'undefined' && window.location.protocol === 'https:';

export const API_BASE_URL = `${IS_SECURE ? 'https' : 'http'}://${BACKEND_HOST}/api`;
export const WS_BASE_URL = `${IS_SECURE ? 'wss' : 'ws'}://${BACKEND_HOST}`;

/**
 * Where the browser tier sends git traffic. Git hosts send no CORS headers, so a page
 * cannot clone or push directly — every request goes through a proxy that adds them.
 *
 * Defaults to our own backend route (host-allow-listed there, deliberately not an open
 * proxy). Override with VITE_GIT_CORS_PROXY to point at a separate deployment — which is
 * what a fully static host would do, since the proxy is the one server-side piece the
 * browser tier still needs.
 */
export const GIT_CORS_PROXY =
  (import.meta as any).env.VITE_GIT_CORS_PROXY || `${API_BASE_URL}/git-proxy`;