// frontend/src/config/env.ts

// this file has all our env data

// The 'as any' forces TypeScript to stop inspecting import.meta
const BACKEND_HOST = (import.meta as any).env.VITE_BACKEND_HOST || 'localhost:8080';

// Safely check if 'window' exists before checking the protocol
const IS_SECURE = typeof window !== 'undefined' && window.location.protocol === 'https:';

export const API_BASE_URL = `${IS_SECURE ? 'https' : 'http'}://${BACKEND_HOST}/api`;
export const WS_BASE_URL = `${IS_SECURE ? 'wss' : 'ws'}://${BACKEND_HOST}`;