// backend/src/services/sandbox/IdleSweeper.ts
import { ISessionRepository, ISandboxRepository } from '../../database/interfaces';
import { SandboxManager } from './SandboxManager';


/**
 * @class IdleSweeper
 * @description The automated resource optimizer. This background daemon bridges 
 * the gap between decoupled Sessions and Sandboxes. It continuously monitors 
 * active infrastructure and freezes containers that have no active users, 
 * preventing massive cloud compute costs.
 */
export class IdleSweeper {
  private sweepInterval: NodeJS.Timeout;

  constructor(
    private sessionRepo: ISessionRepository,
    private sandboxRepo: ISandboxRepository,
    private sandboxManager: SandboxManager
  ) {
    // Default to 5 minutes, but allow overriding via .env
    // e.g., SWEEP_INTERVAL_MS=3600000 for 1 hour during local dev
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
   */
  private async runSweep() : Promise<void> {
    console.log('[IdleSweeper] Scanning for orphaned sandboxes...');
    
    // 1. Get all currently running sandboxes
    const allSandboxes = await this.sandboxRepo.list(); 
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
