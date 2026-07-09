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

  // Which sandbox driver backs SandboxManager (see services/sandbox/drivers).
  // 'opensandbox' = Rust-kernel driver (default; exec-only, no PTY).
  // 'alibaba'     = AlibabaSdkDriver (adds an interactive PTY; requires the
  //                 @alibaba-group/opensandbox SDK + server-side validation).
  SANDBOX_DRIVER: process.env.SANDBOX_DRIVER || 'opensandbox',

  // The public-facing URL of THIS backend server.
  // In your local .env, this is "http://localhost:3000"
  // In your production .env, this will be "https://api.yourdomain.com"
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || 'http://localhost:3000',

  // The single browser origin allowed to make credentialed (cookie-bearing)
  // requests. MUST be an explicit origin — a wildcard is incompatible with
  // `credentials: true`. Local dev is the Vite dev server on :5173.
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',

  NODE_ENV: process.env.NODE_ENV || 'development',

  // HMAC key for the `uid` identity cookie. Unset in dev => a random key is
  // generated and persisted (see api/middleware/auth). Unset in production =>
  // the server refuses to boot rather than issue forgeable identities.
  AUTH_SECRET: process.env.AUTH_SECRET || '',

  // Bearer for the god-mode admin routes. UNSET => those routes are disabled
  // (404), which is the safe default: an unauthenticated force-destroy endpoint
  // is worse than no admin endpoint.
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
};

export const IS_PRODUCTION = config.NODE_ENV === 'production';