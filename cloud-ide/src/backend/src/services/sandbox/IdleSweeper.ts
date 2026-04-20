// backend/src/services/sandbox/IdleSweeper.ts
import { ISessionRepository, ISandboxRepository } from '../../database/interfaces';
import { SandboxManager } from './SandboxManager';


/**
 * @class IdleSweeper
 * @description The automated resource optimizer (Scale-to-Zero Daemon). 
 * * It continuously monitors active infrastructure and freezes (pauses via cgroups) 
 * containers that have no active users. This prevents runaway cloud compute costs.
 * * NOTE: For this to work without disrupting users, the Gateway Controllers must 
 * implement a "Wake-on-Demand" pattern, catching requests to paused sandboxes 
 * and resuming them prior to routing traffic.
 */
export class IdleSweeper {
  private sweepInterval: NodeJS.Timeout;

  constructor(
    private sessionRepo: ISessionRepository,
    private sandboxRepo: ISandboxRepository,
    private sandboxManager: SandboxManager
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
              await this.sandboxManager.destroy(sandbox.sandboxId);
              continue;
           }
       } catch (error: any) {
           // Rust returns a 404/NOT_FOUND equivalent
           console.error(`[IdleSweeper] Sandbox ${sandbox.sandboxId} NOT_FOUND in Rust. Pruning ghost record.`);
           // Call destroy to ensure DB and Worktree are cleaned up!
           await this.sandboxManager.destroy(sandbox.sandboxId);
           continue; 
       }
    }

    const runningSandboxes = allSandboxes.filter(sbx => sbx.state === 'RUNNING');

    for (const sandbox of runningSandboxes) {
      // 2. Find all sessions connected to this sandbox
      const activeSessions = await this.sessionRepo.getSessionsBySandboxId(sandbox.sandboxId);
      
      // 3. If there are NO active sessions, the sandbox is idle
      const isIdle = activeSessions.length === 0 || activeSessions.every(s => s.state === 'DISCONNECTED');

      if (isIdle) {
        console.log(`[IdleSweeper] Sandbox ${sandbox.sandboxId} is idle. Pausing to save compute...`);
        // Tell Rust to freeze the container!
        await this.sandboxManager.pause(sandbox.sandboxId);
      }
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