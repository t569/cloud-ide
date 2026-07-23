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

/**
 * Pre-create an empty JSON store if it doesn't exist. BEST EFFORT — it never rejects, and
 * that is the entire point.
 *
 * Each JSON repository kicks this off in its constructor and stores the promise as
 * `ready`, which every subsequent read awaits. So if this promise REJECTS, it does not
 * fail once — it poisons the repository for the lifetime of the process, and every later
 * read/write rejects with a stale error. In PersistenceLayer those reads run inside async
 * EventEmitter listeners, where an unhandled rejection takes the gateway down: exactly the
 * failure mode JsonSessionRepository's atomic writes were introduced to prevent.
 *
 * The failure is real, not theoretical: `rename` over a file another process holds open
 * raises EPERM on Windows, and a concurrent writer opens that window. Reproduced at ~1 in
 * 1600 constructions under parallel load.
 *
 * Swallowing is safe because a missing file is already a valid state — every reader here
 * treats absent-or-empty as an empty database — so the pre-creation is an optimisation,
 * not an invariant.
 */
export async function ensureJsonFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonAtomic(filePath, {}).catch(() => {});
  }
}
