// backend/src/api/middleware/auth.ts
//
// THE IDENTITY SEAM. Everything downstream (ownership guards, sandbox records,
// session records) asks this file "who is this request?" and nothing else knows.
//
// Today the answer is a stub: a per-browser anonymous id, minted into an httpOnly
// `uid` cookie on first contact. There is no login, no password, no user table —
// possession of the cookie IS the identity. That is enough to make the ownership
// guards real (one browser cannot reach another browser's sandbox) without
// building auth yet.
//
// WHEN LOGIN LANDS: replace the body of `currentUser`/`readUserId` with a real
// lookup (verify a signed session/JWT, resolve to a user row). The signature —
// request in, stable user id out — does not change, so no caller changes either.
// Also delete the legacy-adoption fallback in security.ts (see userOwnsSandbox).
//
// LIMITS OF THE STUB, stated plainly:
//   - Clearing cookies orphans that browser's sandboxes (IdleSweeper reaps them).
//   - The id is a bearer token with no expiry and no revocation.
//   - It is httpOnly, so XSS can't read it, but it is not signed: anyone who can
//     set their own `uid` cookie can impersonate a known id. Signing (or real
//     auth) is required before this is exposed to untrusted users.
import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { parseCookies, USER_COOKIE_OPTIONS } from './security';

export const UID_COOKIE = 'uid';

// Augment Express's own Request, not the global namespace: a `declare global`
// here leaks into every file's global scope and clobbers ambient test types.
declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `attachUser`. Always present on routes mounted after it. */
    userId?: string;
  }
}

/**
 * Reads the caller's user id without minting one. Pure — safe on paths that have
 * no Response to set a cookie on (the WebSocket upgrade in PtyGateway), where a
 * missing id must simply mean "not authorized" rather than "here, have one".
 */
export function readUserId(cookieHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  return parseCookies(header)[UID_COOKIE] || undefined;
}

/**
 * Resolves the caller, minting an anonymous identity on first contact. Mutating
 * (it may set a cookie), so it needs the Response — use `readUserId` where you
 * only have a Request.
 */
export function currentUser(req: Request, res: Response): string {
  // Idempotent: `attachUser` has normally already resolved this request, and
  // re-minting here would issue a second cookie and orphan the first.
  if (req.userId) return req.userId;

  const existing = readUserId(req.headers?.cookie);
  if (existing) {
    req.userId = existing;
    return existing;
  }

  const uid = crypto.randomUUID();
  res.cookie(UID_COOKIE, uid, USER_COOKIE_OPTIONS);
  // Populate immediately: later middleware on THIS request must see the new id,
  // and the cookie we just set won't come back until the next one.
  req.userId = uid;
  return uid;
}

/** Attach the caller's identity to every request. Mount before any route. */
export function attachUser(req: Request, res: Response, next: NextFunction) {
  req.userId = currentUser(req, res);
  next();
}
