// backend/src/services/sandbox/IdleSweeper.ts
import { ISandboxRepository } from '../../database/interfaces';
import { SandboxManager } from './SandboxManager';
import { WorkspaceWatchers } from '../WorkspaceWatchers';

/**
 * How long after a boot/resume a sandbox is immune from pausing. Covers the gap
 * between `provision`/`resume` returning and the editor's SSE stream attaching —
 * without it, a sweep landing in that window pauses the sandbox the user is
 * currently waiting on, and `waitForRunning` spins on PAUSED until it times out.
 */
const GRACE_MS = Number(process.env.IDLE_GRACE_MS) || 2 * 60 * 1000;

/**
 * How long a PAUSED sandbox keeps its container before the compute is handed back. A
 * paused container still pins its writable layer and its slice of the daemon's memory;
 * after a few days of nobody touching it, that is pure waste.
 *
 * This releases the CONTAINER ONLY. The record and its git worktree — the user's actual
 * files — survive untouched, and reopening boots a fresh container onto them
 * (SandboxManager.releaseCompute -> ensureRunning -> recover). Nothing here can delete a
 * workspace; that stays an explicit user action behind the Delete button.
 */
const MAX_IDLE_DAYS = Number(process.env.SANDBOX_MAX_IDLE_DAYS) || 3;
const MAX_IDLE_MS = MAX_IDLE_DAYS * 24 * 60 * 60 * 1000;

/**
 * @class IdleSweeper
 * @description The automated resource optimizer (Scale-to-Zero Daemon).
 * * It continuously monitors active infrastructure and freezes (pauses via cgroups)
 * containers that have no active users. This prevents runaway cloud compute costs.
 * * NOTE: For this to work without disrupting users, the Gateway Controllers must
 * implement a "Wake-on-Demand" pattern, catching requests to paused sandboxes
 * and resuming them prior to routing traffic.
 *
 * "No active users" is answered by `WorkspaceWatchers.isViewed` — an SSE subscriber
 * is held for exactly as long as an editor has the workspace open, and the socket
 * dies with the tab. We deliberately do NOT consult `SessionRepository`: a
 * `SessionRecord` only leaves ACTIVE via `DELETE /api/v1/sessions/:id`, which no
 * client calls, so every sandbox ever launched looked permanently busy and nothing
 * was ever paused. ponytail: reuse the ref-count that already exists, don't add a
 * heartbeat. If the gateway ever spans nodes, this count must go to shared state
 * alongside FsEventHub's pub/sub.
 */
export class IdleSweeper {
  private sweepInterval: NodeJS.Timeout;

  constructor(
    private sandboxRepo: ISandboxRepository,
    private sandboxManager: SandboxManager,
    private watchers: WorkspaceWatchers,
  ) {
    // Allows overriding via .env (e.g., SWEEP_INTERVAL_MS=3600000 for 1 hr in dev mode)
    // to prevent aggressive pausing while debugging locally. Defaults to 5 minutes.
    // (It read `50 * 60 * 1000` — 50 minutes — while every comment around it claimed 5,
    // so scale-to-zero ran an order of magnitude later than intended and idle sandboxes
    // burned compute for the best part of an hour.)
    const intervalMs = process.env.SWEEP_INTERVAL_MS
    ? parseInt(process.env.SWEEP_INTERVAL_MS, 10)
    : 5 * 60 * 1000;
    console.log(`[IdleSweeper] Initialized. Sweeping every ${intervalMs / 1000} seconds.`);
    this.sweepInterval = setInterval(() => this.runSweep(), intervalMs);
  }

 /**
   * @private
   * @description Identifies and freezes orphaned compute containers by doing a 
   * relational lookup between running sandboxes and disconnected sessions.
   * * Additionally performs a health-check (1b): if Rust reports a sandbox as 
   * NOT_FOUND, it deletes the orphaned DB record and cleans up the worktree.
   */
  private async runSweep() : Promise<void> {
    console.log('[IdleSweeper] Scanning for orphaned sandboxes...');
    
    // 1. Get all currently running sandboxes
    const allSandboxes = await this.sandboxRepo.list(); 

    // 1b. Reconcile the recorded state with the engine's.
    //
    // This loop used to DESTROY any sandbox the engine reported as ERROR/STOPPED, or
    // that it had forgotten (a 404 throws out of getStatus). destroy() removes the
    // worktree — `git worktree remove -f` plus `git branch -D` — so a container that
    // simply didn't survive a dockerd restart took the user's workspace with it, and
    // committed work went with the deleted branch. A sweep must never be able to
    // delete a workspace; the two are not the same object.
    //
    // A dead container is now just a stale record: `getStatus` writes the real state
    // back, and the next open recovers onto the still-intact worktree
    // (SandboxManager.recover). So we leave the record ALONE — it is the only thing
    // that still points at the user's files.
    // ponytail: records for sandboxes nobody ever reopens accumulate. They are a few
    // hundred bytes plus a worktree; reap them on an explicit age policy (and only
    // with the user's say-so), never as a side effect of a health check.
    for (const sandbox of allSandboxes) {
      try {
        const status = await this.sandboxManager.getStatus(sandbox.sandboxId);
        if (status.state === 'ERROR' || status.state === 'STOPPED') {
          console.warn(
            `[IdleSweeper] Sandbox ${sandbox.sandboxId} is ${status.state}; its worktree is kept and will be recovered on next open.`,
          );
        }
      } catch {
        console.warn(
          `[IdleSweeper] Sandbox ${sandbox.sandboxId} is unknown to the engine; keeping the record so its workspace can be recovered.`,
        );
      }
    }

    // Re-read: getStatus above wrote the engine's truth back to each record, so the
    // list we started with is stale. Using it would try to pause containers we just
    // learned are dead.
    const reconciled = await this.sandboxRepo.list();
    const now = Date.now();

    // 1c. Long-idle PAUSED sandboxes give their container back. The worktree stays, so
    // this is reversible: the next open recovers onto the same files. (The record's own
    // ponytail note asked for exactly this — an explicit age policy, and never a
    // workspace deletion as a side effect of a sweep.)
    for (const sandbox of reconciled.filter((sbx) => sbx.state === 'PAUSED')) {
      const lastActive = sandbox.lastActiveAt ?? sandbox.createdAt;
      if (now - lastActive < MAX_IDLE_MS) continue;

      console.log(
        `[IdleSweeper] Sandbox ${sandbox.sandboxId} has been paused for over ${MAX_IDLE_DAYS}d. ` +
          `Releasing its container; the workspace is kept and reopens on demand.`,
      );
      await this.sandboxManager.releaseCompute(sandbox.sandboxId);
    }

    for (const sandbox of reconciled.filter((sbx) => sbx.state === 'RUNNING')) {
      // 2. Is an editor holding this workspace open right now?
      if (this.watchers.isViewed(sandbox.sandboxId)) continue;

      // 3. Freshly booted/resumed sandboxes get a grace period to attach.
      //    A record predating lastActiveAt has none — fall back to createdAt.
      const lastActive = sandbox.lastActiveAt ?? sandbox.createdAt;
      if (now - lastActive < GRACE_MS) continue;

      console.log(`[IdleSweeper] Sandbox ${sandbox.sandboxId} is idle. Pausing to save compute...`);
      await this.sandboxManager.pause(sandbox.sandboxId);
    }
  }

  /**
   * @description Clears the Node interval loop, allowing for clean backend 
   * teardown during server deployments or testing.
   */
  public stop() {
    clearInterval(this.sweepInterval);
  }
}