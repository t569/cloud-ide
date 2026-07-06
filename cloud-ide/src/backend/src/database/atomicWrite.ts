import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Crash-safe JSON write: serialise to a temp file in the same directory, then
 * rename over the target. rename() is atomic on a single filesystem (POSIX, and
 * Windows via MoveFileEx with replace), so a concurrent reader — or a reader
 * after a crash mid-write — never sees a torn or truncated file.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {}); // don't leak the temp on failure
    throw err;
  }
}
