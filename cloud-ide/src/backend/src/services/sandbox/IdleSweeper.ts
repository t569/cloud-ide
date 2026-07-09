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
    const intervalMs = process.env.SWEEP_INTERVAL_MS
    ? parseInt(process.env.SWEEP_INTERVAL_MS, 10)
    : 50 * 60 * 1000;
    // Run the sweep every 5 minutes
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

    // 1b. Self-Healing Loop: Check true status from Rust Core
    for (const sandbox of allSandboxes) {
       try {
           // Poll the Rust engine. This will throw or return an error state if the container doesn't exist
           const status = await this.sandboxManager.getStatus(sandbox.sandboxId);
           
           if (status.state === 'ERROR' || status.state === 'STOPPED') {
              console.warn(`[IdleSweeper] Sandbox ${sandbox.sandboxId} is in ${status.state} state in Rust. Triggering cleanup.`);
              // Never force: a dirty worktree makes destroy throw, preserving
              // uncommitted work. Log and let a human (or force-destroy) decide.
              await this.sandboxManager.destroy(sandbox.sandboxId)
                .catch((err) => console.warn(`[IdleSweeper] Cleanup of ${sandbox.sandboxId} skipped: ${err.message}`));
              continue;
           }
       } catch (error: any) {
           // Rust returns a 404/NOT_FOUND equivalent
           console.error(`[IdleSweeper] Sandbox ${sandbox.sandboxId} NOT_FOUND in Rust. Pruning ghost record.`);
           // Call destroy to ensure DB and Worktree are cleaned up!
           await this.sandboxManager.destroy(sandbox.sandboxId)
             .catch((err) => console.warn(`[IdleSweeper] Prune of ${sandbox.sandboxId} skipped: ${err.message}`));
           continue;
       }
    }

    const runningSandboxes = allSandboxes.filter(sbx => sbx.state === 'RUNNING');

    const now = Date.now();

    for (const sandbox of runningSandboxes) {
      // 2. Is an editor holding this workspace open right now?
      if (this.watchers.isViewed(sandbox.sandboxId)) continue;

      // 3. Freshly booted/resumed sandboxes get a grace period to attach.
      //    A record predating lastActiveAt has none — fall back to createdAt.
      const lastActive = sandbox.lastActiveAt ?? sandbox.createdAt;
      if (now - lastActive < GRACE_MS) continue;

      console.log(`[IdleSweeper] Sandbox ${sandbox.sandboxId} is idle. Pausing to save compute...`);
      // Tell Rust to freeze the container!
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