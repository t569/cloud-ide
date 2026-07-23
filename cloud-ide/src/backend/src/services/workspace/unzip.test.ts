// The upload parser, against bytes we do not control. Two kinds of case here:
// a REAL archive (produced by Windows Compress-Archive, base64'd in) to prove the reader
// handles what actual zippers emit, and hand-built hostile archives for every escape.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractZip, safeEntryPath, DEFAULT_LIMITS } from './unzip';

// A genuine zip: readme.md + src/main.ts (deflated). Note PowerShell writes the nested
// name with a BACKSLASH (`src\main.ts`) — non-conformant, and common enough that the
// reader has to normalise it. That quirk is the reason this fixture is a real one.
const REAL_ZIP_B64 =
  'UEsDBBQAAAAIAIxO91yBuC5FHQAAAKYBAAALAAAAc3JjXG1haW4udHN7v3t/akVBflGJQnJ+XnGJQoWCrUL' +
  'iKBhUwJoLAFBLAwQUAAAACACMTvdcpVQ9AQ0AAAALAAAACQAAAHJlYWRtZS5tZHu/e7+yQkZqTk4+FwBQSw' +
  'ECFAAUAAAACACMTvdcgbguRR0AAACmAQAACwAAAAAAAAAAAAAAAAAAAAAAc3JjXG1haW4udHNQSwECFAAUA' +
  'AAACACMTvdcpVQ9AQ0AAAALAAAACQAAAAAAAAAAAAAAAABGAAAAcmVhZG1lLm1kUEsFBgAAAAACAAIAcAAA' +
  'AHoAAAAAAA==';

/** Minimal STORED-entry zip builder, so a hostile archive can be described exactly. */
function makeZip(entries: { name: string; data?: string; madeBy?: number; flags?: number; extAttrs?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data ?? '', 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(0, 8);          // stored
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.madeBy ?? 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.extAttrs ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, eocd]);
}

describe('safeEntryPath', () => {
  it('accepts ordinary relative names and normalises Windows separators', () => {
    expect(safeEntryPath('readme.md')).toBe('readme.md');
    expect(safeEntryPath('src\\main.ts')).toBe('src/main.ts');
    expect(safeEntryPath('./a//b.txt')).toBe('a/b.txt');
  });

  it('rejects every shape of escape', () => {
    expect(safeEntryPath('../escape.txt')).toBeNull();
    expect(safeEntryPath('a/../../escape.txt')).toBeNull();
    expect(safeEntryPath('/etc/passwd')).toBeNull();
    expect(safeEntryPath('C:\\Windows\\evil')).toBeNull();
    expect(safeEntryPath('a\0b')).toBeNull();
    expect(safeEntryPath('')).toBeNull();
  });
});

describe('extractZip', () => {
  let dest: string;

  beforeEach(async () => {
    dest = await fs.mkdtemp(path.join(os.tmpdir(), 'unzip-'));
  });
  afterEach(async () => {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
  });

  it('extracts a REAL zip, deflate and nested paths and all', async () => {
    const written = await extractZip(Buffer.from(REAL_ZIP_B64, 'base64'), dest);
    expect(written).toBe(2);
    // ﻿: the fixture's own UTF-8 BOM, written by PowerShell. Asserted rather than
    // stripped — the bytes must come back exactly as they went in, decoration included.
    expect(await fs.readFile(path.join(dest, 'readme.md'), 'utf8')).toBe('﻿# hello\n');
    // Landed under a real subdirectory despite the archive's `src\main.ts` name.
    const main = await fs.readFile(path.join(dest, 'src', 'main.ts'), 'utf8');
    expect(main).toBe(`﻿export const x = ${'a'.repeat(400)};\n`);
  });

  it('writes a plain stored entry', async () => {
    await extractZip(makeZip([{ name: 'a.txt', data: 'hi' }]), dest);
    expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf8')).toBe('hi');
  });

  it('refuses zip-slip (../) and never writes outside dest', async () => {
    const zip = makeZip([{ name: '../escaped.txt', data: 'pwned' }]);
    await expect(extractZip(zip, dest)).rejects.toThrow(/Unsafe path/);
    await expect(fs.access(path.join(dest, '..', 'escaped.txt'))).rejects.toThrow();
  });

  it('refuses an absolute entry path', async () => {
    await expect(extractZip(makeZip([{ name: '/etc/cron.d/x', data: 'x' }]), dest)).rejects.toThrow(/Unsafe path/);
  });

  it('refuses a unix symlink entry', async () => {
    // madeBy 3 = unix; mode 0xA1FF = S_IFLNK | 0777, in the high half of extAttrs.
    const zip = makeZip([{ name: 'link', data: '/etc/passwd', madeBy: 3 << 8, extAttrs: 0xa1ff0000 }]);
    await expect(extractZip(zip, dest)).rejects.toThrow(/symlink/);
  });

  it('refuses an encrypted entry', async () => {
    await expect(extractZip(makeZip([{ name: 'a', data: 'x', flags: 0x1 }]), dest)).rejects.toThrow(/Encrypted/);
  });

  it('refuses more entries than the limit allows', async () => {
    const zip = makeZip([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    await expect(extractZip(zip, dest, { ...DEFAULT_LIMITS, maxEntries: 2 })).rejects.toThrow(/too many entries/);
  });

  it('refuses an entry over the per-file cap (the bomb budget)', async () => {
    const zip = makeZip([{ name: 'big.bin', data: 'x'.repeat(1000) }]);
    await expect(extractZip(zip, dest, { ...DEFAULT_LIMITS, maxFileBytes: 100 })).rejects.toThrow(/per-file limit/);
  });

  it('refuses bytes that are not a zip at all', async () => {
    await expect(extractZip(Buffer.from('not a zip, just some text'), dest)).rejects.toThrow(/Not a zip archive/);
  });
});
