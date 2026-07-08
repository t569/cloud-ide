// backend/src/services/SessionStore.ts
//
// The "unified local log dump + recovery" surface (Gap B). A terminal's live
// state — cwd, env, running processes — lives inside the container and survives
// pause/resume with it; the one thing that doesn't is the scrollback the user
// sees. We snapshot that to a small per-terminal JSON file so a browser wipe,
// device switch, or gateway restart can rebuild the visible session.
//
// Kept OUTSIDE the git worktree on purpose: the worktree is the source of truth
// for files and `git status --porcelain` gates destroy() — writing session
// state into it would dirty the tree. This lives in a sibling data/sessions/.
//
// ponytail: no WAL/Merkle for files — the git worktree already is both (durable
// object store + reflog). This only persists what git doesn't hold.
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeJsonAtomic } from '../database/atomicWrite';

export interface SessionSnapshot {
  v: 1;
  terminalId: string;
  ts: number;
  /** xterm SerializeAddon output — the terminal's visible scrollback. */
  scrollback: string;
}

// Same charset the FS routes already enforce on sandboxId. Guards against path
// traversal in the terminalId sub-key (the backend must not trust the client).
const SAFE_KEY = /^[a-zA-Z0-9_-]+$/;

export class SessionStore {
  constructor(private root: string = path.resolve(process.cwd(), 'data', 'sessions')) {}

  private fileFor(sandboxId: string, terminalId: string): string {
    if (!SAFE_KEY.test(sandboxId) || !SAFE_KEY.test(terminalId)) {
      throw new Error('Invalid session key');
    }
    return path.join(this.root, sandboxId, `${terminalId}.json`);
  }

  /** Persist a terminal snapshot atomically (temp + rename — crash-safe). */
  async save(sandboxId: string, snapshot: SessionSnapshot): Promise<void> {
    await writeJsonAtomic(this.fileFor(sandboxId, snapshot.terminalId), snapshot);
  }

  /** Load a terminal snapshot, or null if none exists / is unreadable. */
  async load(sandboxId: string, terminalId: string): Promise<SessionSnapshot | null> {
    // Validate first, OUTSIDE the try — a bad key is a caller error and must
    // propagate, not be swallowed by the best-effort "no snapshot yet" catch.
    const file = this.fileFor(sandboxId, terminalId);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as SessionSnapshot;
    } catch {
      return null; // no snapshot yet, or corrupt — recovery is best-effort
    }
  }
}
