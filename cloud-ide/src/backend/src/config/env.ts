// backend/src/config/env.ts

// this file has all our env data

// backend/src/config/env.ts

// this file has all our env data
// backend/src/config/env.ts

import dotenv from 'dotenv';

// Load the .env file immediately when this file is imported
dotenv.config();

// Export a single, strictly-typed configuration object
export const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),

  // The internal infrastructure URL (Rust/OpenSandbox)
  OPENSANDBOX_API_URL: process.env.OPENSANDBOX_API_URL || 'http://127.0.0.1:8080',
  OPENSANDBOX_API_KEY: process.env.OPENSANDBOX_API_KEY || '',
  OPENSANDBOX_EXECD_ACCESS_TOKEN: process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN || '',

  // The public-facing URL of THIS backend server.
  // In your local .env, this is "http://localhost:3000"
  // In your production .env, this will be "https://api.yourdomain.com"
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || 'http://localhost:3000',

  // The single browser origin allowed to make credentialed (cookie-bearing)
  // requests. MUST be an explicit origin — a wildcard is incompatible with
  // `credentials: true`. Local dev is the Vite dev server on :5173.
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
};