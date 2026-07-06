// shared/utils/naming.ts
//
// SINGLE SOURCE OF NAMING VALIDITY for environments. Both the frontend and the
// backend import from here — no other place decides what a valid id/name/tag is.
//
// Model (identity decoupled from label):
//   id    — opaque, system-generated, immutable. RFC 1123 label. Drives the
//           image tag, so renaming never re-tags or rebuilds.
//   name  — free-form human display name (validated, not unique).
//   slug  — RFC 1123 label derived from `name`, for URLs/display only.
//
// Standards:
//   RFC 1123 label  — https://datatracker.ietf.org/doc/html/rfc1123 (also the
//                     Kubernetes name standard): [a-z0-9]([-a-z0-9]*[a-z0-9])?, <=63.
//   OCI/Docker ref  — image name component: [a-z0-9]+([._-][a-z0-9]+)*.

import { EnvironmentConfig } from '../types/env';

// ---- Grammar -------------------------------------------------------------

const RFC1123_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE_REF = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[\w][\w.-]{0,127})?$/;
const COMBINING_MARKS = /[̀-ͯ]/g;

export const NAME_MAX = 100;
export const LABEL_MAX = 63;

// ---- Validity (the source of truth) --------------------------------------

/** A system id or slug is valid iff it is an RFC 1123 label. */
export const isValidId = (id: string): boolean => RFC1123_LABEL.test(id);

/** A fully-qualified `name:tag` is a legal Docker/OCI reference. */
export const isValidImageRef = (ref: string): boolean => IMAGE_REF.test(ref);

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validate a human display name. Trims; empty/oversized are rejected. */
export function validateName(raw: string | undefined | null): NameCheck {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { ok: false, error: 'Name cannot be empty' };
  if (value.length > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer` };
  return { ok: true, value };
}

// ---- Derivation ----------------------------------------------------------

/** Turn arbitrary text into an RFC 1123 label (lowercase, alnum + single '-'). */
export function slugify(input: string | undefined | null): string {
  return (input ?? '')
    .normalize('NFKD')                 // accented char -> base char + combining mark
    .replace(COMBINING_MARKS, '')      // drop the marks (café -> cafe)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // any run of non-alnum -> single '-'
    .replace(/^-+|-+$/g, '')           // trim leading/trailing '-'
    .slice(0, LABEL_MAX)
    .replace(/-+$/g, '');              // a slice can end mid-separator
}

/** The canonical, rename-stable image tag for an environment id. */
export function toImageName(id: string, tag = 'latest'): string {
  if (!isValidId(id)) throw new Error(`Refusing to build image for unsafe id: "${id}"`);
  return `cloud-ide-${id}:${tag}`;
}

// ---- Content-addressed versioning ---------------------------------------

/**
 * Deterministic content tag for a build config — a 64-bit FNV-1a over a
 * canonical projection. Same inputs -> same tag (enables rollback + cache
 * hits); order of build steps matters (Dockerfile order), package/env order
 * does not. ponytail: non-cryptographic — collision-negligible for realistic
 * build counts; swap for SHA-256 if you ever need collision *resistance*.
 */
export function contentTag(config: EnvironmentConfig): string {
  const canonical = JSON.stringify({
    baseImage: config.baseImage ?? '',
    bootUpAsRoot: config.bootUpAsRoot ?? false,
    platform: config.platform ?? '',
    env: config.env
      ? Object.keys(config.env).sort().map((k) => [k, config.env![k]])
      : [],
    steps: (config.buildSteps ?? []).map((s) => ({
      type: s.type,
      packages: [...(s.packages ?? [])].sort(),
      command: s.command ?? '',
      targetPath: s.targetPath ?? '',
      isGlobal: !!s.isGlobal,
      version: s.version ?? '',
    })),
  });

  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Content-addressed image tag: cloud-ide-<id>:<contentHash>. */
export const toVersionedImageName = (id: string, config: EnvironmentConfig): string =>
  toImageName(id, contentTag(config));

// ---- Generation ("name it ourselves") ------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomChars(len: number): string {
  const g = globalThis as { crypto?: Crypto };
  let out = '';
  if (g.crypto?.getRandomValues) {
    const buf = new Uint8Array(len);
    g.crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  } else {
    // ponytail: ids are unique-enough tokens, not secrets — Math.random fallback
    // is fine on the rare runtime without WebCrypto. Collision space is 36^10.
    for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Opaque, immutable, RFC 1123-safe environment id, e.g. "env-7f3a9c2b1d". */
export const generateId = (): string => `env-${randomChars(10)}`;

const ADJECTIVES = [
  'brave', 'calm', 'clever', 'eager', 'gentle', 'jolly', 'keen', 'lucid',
  'merry', 'nimble', 'proud', 'quiet', 'sharp', 'swift', 'vivid', 'witty',
];
const NAMES = [
  'turing', 'lovelace', 'hopper', 'knuth', 'ritchie', 'thompson', 'dijkstra',
  'noether', 'euler', 'gauss', 'curie', 'tesla', 'bohr', 'hamilton', 'shannon', 'babbage',
];
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** A friendly, valid-by-construction display name, e.g. "brave-turing". */
export const generateFriendlyName = (): string => `${pick(ADJECTIVES)}-${pick(NAMES)}`;

// ---- Policy --------------------------------------------------------------

export interface ResolvedNaming { id: string; name: string; slug: string }

/**
 * Naming policy for a NEW environment: always mint a fresh opaque id; use the
 * given name if valid, otherwise name it ourselves. Throws only if a name was
 * supplied but is actively invalid (e.g. too long).
 */
export function resolveNewNaming(rawName?: string | null): ResolvedNaming {
  let name: string;
  if (rawName == null || rawName.trim() === '') {
    name = generateFriendlyName();
  } else {
    const check = validateName(rawName);
    if (!check.ok) throw new Error(check.error);
    name = check.value;
  }
  const id = generateId();
  return { id, name, slug: slugify(name) || id };
}
