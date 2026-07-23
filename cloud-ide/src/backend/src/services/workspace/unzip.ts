// backend/src/services/workspace/unzip.ts
//
// A deliberately SMALL zip reader for uploaded workspace archives. Node ships deflate
// (zlib.inflateRawSync) but no zip container reader, and the container is the easy half —
// so this is stdlib plus ~100 lines rather than a dependency in the one path that parses
// bytes an anonymous browser uploaded.
//
// It stays small by REFUSING rather than handling: no encryption, no zip64, no symlinks,
// no compression method but stored/deflate. Every rejection is one less code path over
// untrusted input, and none of them is something a "zip this folder" archive contains.
//
// Read from the CENTRAL DIRECTORY, never by scanning local headers forward. The central
// directory always carries true sizes; local headers may defer them to a trailing data
// descriptor (macOS and other streaming zippers do exactly that), and a reader that
// trusted the local header would mis-slice those archives.
//
// ponytail: buffers the whole archive in memory — fine at the 100 MB cap the route sets.
// Stream to a temp file first if uploads ever get big enough for that to matter.

import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export interface UnzipLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** The zip-bomb budget: a 100 MB upload cannot become an unbounded write. */
export const DEFAULT_LIMITS: UnzipLimits = {
  maxEntries: 20_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

/**
 * An archive entry name → a safe relative POSIX path, or null if it must not be written.
 *
 * This is the zip-slip guard. An entry may claim any name it likes — `../../etc/cron.d/x`,
 * `C:\Windows\...`, `/etc/passwd` — and a naive join() would honour it. Rejecting is right
 * rather than sanitising: a name that needs rewriting is not one a real archive produced.
 */
export function safeEntryPath(raw: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  const norm = raw.replace(/\\/g, '/');              // some zippers write Windows separators
  if (norm.startsWith('/')) return null;             // absolute (POSIX)
  if (/^[A-Za-z]:/.test(norm)) return null;          // absolute (drive-letter)
  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '..')) return null; // traversal
  return segments.join('/');
}

/** Locate the end-of-central-directory record (last 64 KiB + its own 22 bytes). */
function findEocd(buf: Buffer): number {
  if (buf.length < 22) throw new Error('Not a zip archive (too short).');
  const floor = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a zip archive (no end-of-central-directory record).');
}

/** Slice and decompress one entry, located via its local header. */
function entryData(buf: Buffer, localOffset: number, method: number, compSize: number, uncompSize: number): Buffer {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) {
    throw new Error('Malformed archive (bad local file header).');
  }
  // The local header's name/extra lengths are its OWN — they can differ from the central
  // directory's, so the data offset has to be computed from this header, not that one.
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  if (start + compSize > buf.length) throw new Error('Malformed archive (entry data out of range).');
  const raw = buf.subarray(start, start + compSize);

  let out: Buffer;
  if (method === 0) out = Buffer.from(raw);
  // maxOutputLength makes zlib itself refuse a bomb mid-inflate, rather than us noticing
  // afterwards with the memory already spent.
  else if (method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: uncompSize });
  else throw new Error(`Unsupported compression method ${method} (only stored and deflate).`);

  if (out.length !== uncompSize) throw new Error('Malformed archive (entry size mismatch).');
  return out;
}

/**
 * Extract `buf` into `destDir`. Throws on anything unsafe or unsupported — an archive is
 * accepted whole or not at all, so a rejected upload never leaves a half-written tree.
 * Returns the number of files written.
 */
export async function extractZip(buf: Buffer, destDir: string, limits: UnzipLimits = DEFAULT_LIMITS): Promise<number> {
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);

  // 0xffff/0xffffffff are the zip64 sentinels. We cap far below either, so refusing is
  // honest rather than limiting.
  if (entryCount === 0xffff || cenOffset === 0xffffffff) throw new Error('Zip64 archives are not supported.');
  if (entryCount > limits.maxEntries) throw new Error(`Archive has too many entries (max ${limits.maxEntries}).`);
  if (cenOffset + cenSize > buf.length) throw new Error('Malformed archive (central directory out of range).');

  let cursor = cenOffset;
  let totalBytes = 0;
  let filesWritten = 0;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CEN_SIG) {
      throw new Error('Malformed archive (bad central directory entry).');
    }
    const madeBy = buf.readUInt16LE(cursor + 4);
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const uncompSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const extAttrs = buf.readUInt32LE(cursor + 38);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const rawName = buf.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error('Encrypted archives are not supported.');

    const isDirectory = rawName.endsWith('/');
    const rel = safeEntryPath(rawName);
    if (!rel) throw new Error(`Unsafe path in archive: ${rawName}`);

    // A unix-made zip stores the file mode in the high half of the external attributes.
    // S_IFLNK entries are real symlinks; recreating one from an upload would let the
    // archive plant a link out of the tree that later reads/writes follow.
    if ((madeBy >> 8) === 3 && ((extAttrs >>> 16) & 0xf000) === 0xa000) {
      throw new Error(`Archive contains a symlink (${rel}); not supported.`);
    }

    const target = path.join(destDir, rel);
    if (isDirectory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }

    if (uncompSize > limits.maxFileBytes) throw new Error(`Archive entry ${rel} exceeds the per-file limit.`);
    totalBytes += uncompSize;
    if (totalBytes > limits.maxTotalBytes) throw new Error('Archive exceeds the total uncompressed size limit.');

    const data = entryData(buf, localOffset, method, compSize, uncompSize);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    filesWritten++;
  }

  return filesWritten;
}
