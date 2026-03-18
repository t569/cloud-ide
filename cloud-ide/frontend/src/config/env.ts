// frontend/src/config/env.ts

// this file has all our env data

// Fallback to localhost:8080 if the .env file is missing
const BACKEND_HOST = import.meta.env.VITE_BACKEND_HOST || 'localhost:8080';

// Automatically detect if we are in a secure production environment (e.g., Vercel/AWS)
const IS_SECURE = window.location.protocol === 'https:';

// Export the formatted base URLs
export const API_BASE_URL = `${IS_SECURE ? 'https' : 'http'}://${BACKEND_HOST}/api`;
export const WS_BASE_URL = `${IS_SECURE ? 'wss' : 'ws'}://${BACKEND_HOST}`;