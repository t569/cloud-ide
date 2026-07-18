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
// The cookie is HMAC-signed (`<uuid>.<sig>`), so a caller cannot mint or guess a
// rival identity by setting their own `uid` — a forged value fails verification
// and is treated as no identity at all. httpOnly keeps XSS from lifting it.
//
// LIMITS OF THE STUB, stated plainly:
//   - Clearing cookies orphans that browser's sandboxes (IdleSweeper reaps them).
//   - The id is still a bearer token: no expiry, no revocation. Anyone who steals
//     the cookie value is that user until the signing key rotates.
import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCookies, USER_COOKIE_OPTIONS, timingSafeEqual } from './security';
import { config, IS_PRODUCTION } from '../../config/env';
import { dataPath } from '../../config/paths';

export const UID_COOKIE = 'uid';

/**
 * The HMAC key for identity cookies.
 *
 * Production must supply AUTH_SECRET — we refuse to boot otherwise rather than
 * silently issue identities anyone can forge. In dev we generate one and persist
 * it under data/, so a restart doesn't invalidate every developer's sandboxes.
 */
function loadAuthSecret(): Buffer {
  if (config.AUTH_SECRET) return Buffer.from(config.AUTH_SECRET, 'utf8');

  if (IS_PRODUCTION) {
    throw new Error(
      'AUTH_SECRET is required in production: without it the `uid` identity cookie is unsigned and forgeable.',
    );
  }

  // ponytail: a file, not a key manager. Swap when there is more than one node —
  // two servers with different dev secrets would reject each other's cookies.
  const keyPath = dataPath('.auth-secret');
  try {
    return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  } catch {
    const generated = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 });
    console.warn('[auth] AUTH_SECRET unset — generated a development key at data/.auth-secret');
    return generated;
  }
}

const AUTH_SECRET = loadAuthSecret();

const sign = (value: string): string =>
  crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');

/** `<uuid>.<sig>` — the wire form of an identity. */
export function signUserId(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/**
 * A domain-separated symmetric key derived from AUTH_SECRET (HKDF-SHA256). Same trust
 * property as the identity HMAC above: in production AUTH_SECRET comes from the env, so
 * a leak of the data dir alone cannot re-derive this key — which is the point of
 * encrypting stored secrets (e.g. git PATs) with it. `info` namespaces one purpose from
 * another so two independent keys never collide.
 */
export function deriveKey(info: string, length = 32): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', AUTH_SECRET, Buffer.alloc(0), info, length));
}

/**
 * Recovers the user id from a signed cookie, or undefined if the signature does
 * not verify. Fails closed: a tampered cookie is *no* identity, never a valid one.
 */
export function verifyUserId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return undefined;

  const value = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  return timingSafeEqual(provided, sign(value)) ? value : undefined;
}

// ── Preview access tokens ────────────────────────────────────────────────────────────
// The subdomain preview ingress (`<id>-<port>.localhost`) is a DIFFERENT ORIGIN from the
// app, so the `uid` session cookie is not sent to it. Instead the SPA mints a token (from
// an owner-gated endpoint) and the ingress exchanges it for a subdomain-scoped cookie.
// Same HMAC secret as the identity cookie — a preview token is just a second, narrower
// bearer: it authorizes preview access to exactly ONE sandbox until it expires.

// How long a preview token is valid. Long enough for a coding session, since the whole
// point is a live dev server you keep open; the SPA mints a fresh one each time it opens
// a preview, so an active session always holds a current token.
const PREVIEW_TOKEN_TTL_MS = Number(process.env.PREVIEW_TOKEN_TTL_MS) || 12 * 60 * 60 * 1000;

/** A signed token authorizing preview access to `sandboxId`. Form: `<sandboxId>.<exp>.<sig>`. */
export function mintPreviewToken(sandboxId: string): string {
  const payload = `${sandboxId}.${Date.now() + PREVIEW_TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * True if `token` is a valid, unexpired preview token FOR `sandboxId`. Fails closed on a
 * tampered signature, a mismatched sandbox, or expiry — a bad token is no access.
 * `sandboxId` is bound into the signature, so a token for one sandbox can't open another.
 */
export function verifyPreviewToken(token: string | undefined, sandboxId: string): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return false;

  const payload = token.slice(0, lastDot);
  const provided = token.slice(lastDot + 1);
  if (!timingSafeEqual(provided, sign(payload))) return false;

  const [sid, expStr] = payload.split('.');
  const exp = Number(expStr);
  return sid === sandboxId && Number.isFinite(exp) && exp > Date.now();
}

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
  return verifyUserId(parseCookies(header)[UID_COOKIE]);
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
  res.cookie(UID_COOKIE, signUserId(uid), USER_COOKIE_OPTIONS);
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
