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

/**
 * Are the browser app and this API on the same site, as a cookie sees it?
 *
 * This decides `SameSite` on every cookie we issue, and it is load-bearing: with
 * `SameSite=Lax` (the old hardcoded value) a browser sends our session cookie only
 * on same-site requests. Today that's fine — :5173 and :3000 are both `localhost`,
 * and PORTS DO NOT AFFECT SAME-SITE. But split the app onto app.example.com and the
 * API onto api.example.com and every credentialed request silently loses its cookie:
 * the preview iframe 404s (the ownership guard sees no caller) and the raw-image
 * route with it.
 *
 * True same-site is "same registrable domain", which needs the Public Suffix List to
 * compute. We don't ship one. Instead we compare HOSTNAMES and treat any difference
 * as cross-site — deliberately the safe direction to be wrong in: `SameSite=None` on
 * a genuinely same-site pair still works (and CSRF is separately covered by the
 * double-submit token and the WS origin check), whereas `Lax` on a cross-site pair
 * drops the cookie and breaks the app in a way that is miserable to diagnose.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const frontendHost = hostOf(config.FRONTEND_ORIGIN);
const apiHost = hostOf(config.PUBLIC_API_URL);

export const CROSS_SITE_COOKIES =
  frontendHost !== null && apiHost !== null && frontendHost !== apiHost;

/**
 * Fail-safe boot checks for multi-tenant deployments — same principle as AUTH_SECRET
 * (see api/middleware/auth): refuse to start rather than run insecurely.
 *
 * execd (the in-sandbox exec daemon on :44772) is reachable from OTHER sandboxes on a
 * shared Docker network. If it accepts unauthenticated commands, tenant A can run code in
 * tenant B's sandbox — a cross-tenant compromise. OPENSANDBOX_EXECD_ACCESS_TOKEN is the
 * shared secret the gateway sends and execd must require; empty means the gateway sends no
 * auth header, so execd had better be rejecting everyone — but "had better be" is not a
 * security posture. In production we require it explicitly.
 *
 * This does NOT by itself isolate sandboxes at the network layer (a dev server on another
 * sandbox's port is still reachable) — that needs per-sandbox networks, tracked separately.
 * It closes the worst leg: unauthenticated cross-tenant exec.
 */
export function assertSecureProductionConfig(): void {
  // A cross-site deployment forces SameSite=None, and EVERY browser discards a
  // SameSite=None cookie that is not also Secure. So this combination doesn't
  // degrade — it hard-breaks auth (no session cookie ⇒ every ownership guard sees
  // an anonymous caller ⇒ the editor, previews and images all 404) and it does so
  // with no error anywhere near the cause. Refuse to start instead. Checked in dev
  // too: this misconfiguration is just as fatal there, and far more likely.
  if (CROSS_SITE_COOKIES && !config.PUBLIC_API_URL.startsWith('https')) {
    throw new Error(
      'Refusing to start: FRONTEND_ORIGIN and PUBLIC_API_URL are on different hosts ' +
        `(${config.FRONTEND_ORIGIN} vs ${config.PUBLIC_API_URL}), which requires SameSite=None cookies — ` +
        'and browsers drop those unless they are Secure. Serve PUBLIC_API_URL over HTTPS, ' +
        'or put the app and the API on the same host.',
    );
  }

  if (!IS_PRODUCTION) {
    if (!config.OPENSANDBOX_EXECD_ACCESS_TOKEN) {
      console.warn(
        '[config] OPENSANDBOX_EXECD_ACCESS_TOKEN unset — fine for local single-tenant dev, ' +
          'but a shared deployment would let one sandbox exec in another. Required in production.',
      );
    }
    return;
  }

  const missing: string[] = [];
  if (!config.OPENSANDBOX_EXECD_ACCESS_TOKEN) missing.push('OPENSANDBOX_EXECD_ACCESS_TOKEN');
  if (missing.length) {
    throw new Error(
      `Refusing to start: ${missing.join(', ')} must be set in production. ` +
        'Without the execd token, one tenant\'s sandbox can execute commands in another\'s.',
    );
  }
}