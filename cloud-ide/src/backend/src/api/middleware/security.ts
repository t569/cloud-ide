// backend/src/api/middleware/security.ts
//
// Server-side half of the auth/CSRF hardening (SECURITY finding #2):
//   - csrfProtection:          double-submit cookie CSRF defense
//   - requireSandboxOwnership: IDOR guard for every :sandboxId route
//   - SESSION_COOKIE_OPTIONS:  httpOnly session cookie settings
//
// WHO the caller is lives in ./auth (the identity seam). This file only decides
// WHAT that caller may touch. Do not import auth from here — auth imports
// parseCookies from this file, and the dependency must stay one-directional.
//
// Cookies are parsed by hand (parseCookies) rather than adding the cookie-parser
// dependency for ~8 lines. res.cookie() is built into Express, so no dep needed
// to SET cookies either.

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { ISandboxRepository } from '../../database/interfaces';
import { config, IS_PRODUCTION, CROSS_SITE_COOKIES } from '../../config/env';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_COOKIE = 'csrf-token'; // readable by JS (double-submit)
export const SID_COOKIE = 'sid';         // httpOnly session bearer

// Secure flag on when this server is served over HTTPS, so local http dev still
// receives cookies — and ALWAYS when we're cross-site, because SameSite=None is
// only honoured on a Secure cookie (the boot guard in config/env refuses the
// cross-site + plain-http combination outright, so this can't silently no-op).
const COOKIE_SECURE = config.PUBLIC_API_URL.startsWith('https') || CROSS_SITE_COOKIES;

// 'lax' while the app and API share a host (the local :5173 → :3000 case; ports do
// not affect same-site). Split them across hosts and Lax would drop the cookie on
// every credentialed request — including the ones the browser makes on our behalf
// for the preview <iframe> and the raw-image <img>, which is exactly where it would
// bite first. See CROSS_SITE_COOKIES.
const COOKIE_SAME_SITE = CROSS_SITE_COOKIES ? ('none' as const) : ('lax' as const);

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: COOKIE_SAME_SITE,
  secure: COOKIE_SECURE,
  path: '/',
};

/**
 * Same hardening as the session cookie (httpOnly/sameSite/secure), but the `uid`
 * bearer must OUTLIVE the browser session. Without an explicit maxAge it is a
 * session cookie: closing the browser drops it, `attachUser` mints a fresh uid on
 * return, and that new identity owns none of your sandboxes — so your workspace
 * "disappears" (the old sandbox is orphaned and the IdleSweeper reaps it). uid is a
 * durable anonymous account, not a per-connection bearer like `sid`. 1 year; login
 * will replace this seam.
 */
export const USER_COOKIE_OPTIONS = {
  ...SESSION_COOKIE_OPTIONS,
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

/**
 * Compares two secrets without leaking their contents through timing. Length is
 * not secret here (tokens are fixed-width), but the bytes are — a naive `!==`
 * short-circuits on the first differing byte and can be walked one byte at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Baseline response headers. This API serves JSON and proxied sandbox output, so
 * the browser must never sniff a content type or frame us.
 *
 * ponytail: no CSP here — this server emits no HTML of its own. The SPA's CSP
 * belongs wherever the SPA is served from (Vite in dev, the CDN/edge in prod).
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS is meaningless (and ignored) over plain http, so only assert it on TLS.
  if (IS_PRODUCTION && COOKIE_SECURE) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/**
 * Gate for the god-mode admin routes (force-destroy bypasses the dirty-worktree
 * pre-flight and deletes a user's worktree).
 *
 * Fails CLOSED: with no ADMIN_TOKEN configured the routes 404 as though they do
 * not exist. An unauthenticated force-destroy is strictly worse than no endpoint,
 * and 404 (not 403) keeps the admin surface from being discoverable.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = config.ADMIN_TOKEN;
  const provided = req.get('x-admin-token') ?? '';
  if (!expected || !timingSafeEqual(provided, expected)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * Parses a raw Cookie header into a name->value map. Returns {} when absent.
 * Pure and exported so it is unit-testable.
 */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * CSRF double-submit cookie protection.
 * - Mints a readable `csrf-token` cookie whenever the client doesn't have one
 *   (so the SPA can read it and echo it back).
 * - On state-changing methods, requires the `x-csrf-token` header to match the
 *   cookie exactly; rejects with 403 otherwise.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') return next(); // CORS preflight

  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[CSRF_COOKIE];

  if (!token) {
    // First contact — issue a token. httpOnly:false so the SPA can read it.
    // Same SameSite/Secure policy as the session cookie: if this one is dropped
    // cross-site, every mutating request 403s on a token it can never read back.
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: COOKIE_SAME_SITE,
      secure: COOKIE_SECURE,
      path: '/',
    });
  }

  if (MUTATING_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    // Absent header is always a rejection — never "skip the check when unset".
    if (!header || !timingSafeEqual(header, token)) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }
  next();
}

/**
 * The IDOR check itself, decoupled from Express so both the HTTP middleware and
 * the WebSocket upgrade handshake (PtyGateway) enforce the SAME rule from one
 * place. Ownership is read from the sandbox record — never inferred from the
 * sandboxId in the URL, which the caller controls.
 *
 * Callers map `false` to 404 (not 403) so sandbox IDs cannot be enumerated.
 */
export async function userOwnsSandbox(
  sandboxRepo: ISandboxRepository,
  userId: string | undefined,
  sandboxId: string | undefined,
): Promise<boolean> {
  if (!userId || !sandboxId) return false;
  try {
    const record = await sandboxRepo.get(sandboxId);
    if (!record) return false;

    // ponytail: sandboxes provisioned before the identity seam existed carry no
    // owner, so they are readable by anyone who knows the id. Adopting them keeps
    // running workspaces reachable across this upgrade.
    // DELETE THIS BRANCH when login lands — until then it is a standing hole.
    if (!record.userId) return true;

    return record.userId === userId;
  } catch (err: any) {
    console.error('[Ownership] lookup failed:', err.message);
    return false;
  }
}

/**
 * IDOR guard for sandbox-scoped routes. Confirms the sandbox at :sandboxId is
 * owned by the caller (see ./auth for who that is). Mount AFTER `attachUser`.
 *
 * Note this is orthogonal to csrfProtection: CSRF stops another site forging a
 * request from this browser; it does nothing to stop this browser asking for a
 * sandbox that belongs to someone else. That is what this guard is for.
 */
export function requireSandboxOwnership(sandboxRepo: ISandboxRepository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();

    const sandboxId = typeof req.params.sandboxId === 'string' ? req.params.sandboxId : undefined;
    if (!(await userOwnsSandbox(sandboxRepo, req.userId, sandboxId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  };
}
