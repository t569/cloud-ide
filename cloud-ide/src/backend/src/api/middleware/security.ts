// backend/src/api/middleware/security.ts
//
// Server-side half of the auth/CSRF hardening (SECURITY finding #2):
//   - csrfProtection:          double-submit cookie CSRF defense
//   - requireSandboxOwnership: IDOR guard for /api/fs/:sandboxId/*
//   - SESSION_COOKIE_OPTIONS:  httpOnly session cookie settings
//
// Cookies are parsed by hand (parseCookies) rather than adding the cookie-parser
// dependency for ~8 lines. res.cookie() is built into Express, so no dep needed
// to SET cookies either.

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { ISessionRepository } from '../../database/interfaces';
import { config } from '../../config/env';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_COOKIE = 'csrf-token'; // readable by JS (double-submit)
export const SID_COOKIE = 'sid';         // httpOnly session bearer

// Secure flag on only when this server is actually served over HTTPS, so local
// http dev still receives cookies.
const COOKIE_SECURE = config.PUBLIC_API_URL.startsWith('https');

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: COOKIE_SECURE,
  path: '/',
};

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
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'lax', secure: COOKIE_SECURE, path: '/' });
  }

  if (MUTATING_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    if (!header || header !== token) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }
  next();
}

type OwnedSession = Awaited<ReturnType<ISessionRepository['get']>>;

/**
 * The IDOR check itself, decoupled from Express so both the HTTP middleware and
 * the WebSocket upgrade handshake (PtyGateway) enforce the SAME rule from one
 * place. Returns the verified session, or null on any failure (bad/missing sid,
 * no link, lookup error). Callers map null to 404 so IDs can't be enumerated.
 */
export async function verifySandboxOwnership(
  sessionRepo: ISessionRepository,
  cookieHeader: string | string[] | undefined,
  sandboxId: string | undefined,
): Promise<OwnedSession> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  const sid = parseCookies(header)[SID_COOKIE];
  if (!sid || !sandboxId) return null;
  try {
    const session = await sessionRepo.get(sid);
    if (!session || session.sandboxId !== sandboxId) return null;
    return session;
  } catch (err: any) {
    console.error('[Ownership] lookup failed:', err.message);
    return null;
  }
}

/**
 * IDOR guard for sandbox-scoped routes. Confirms the caller holds a session
 * (httpOnly `sid` cookie) that is linked to the :sandboxId being accessed.
 * Returns 404 (not 403) on any failure so sandbox IDs cannot be enumerated.
 *
 * Ownership is verified at the data layer (the session->sandbox link), never
 * trusting the sandboxId in the URL on its own.
 */
export function requireSandboxOwnership(sessionRepo: ISessionRepository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();

    const sandboxId = typeof req.params.sandboxId === 'string' ? req.params.sandboxId : undefined;
    const session = await verifySandboxOwnership(sessionRepo, req.headers.cookie, sandboxId);
    if (!session) {
      return res.status(404).json({ error: 'Not found' });
    }
    (req as any).session = session; // hand the verified session downstream
    next();
  };
}
