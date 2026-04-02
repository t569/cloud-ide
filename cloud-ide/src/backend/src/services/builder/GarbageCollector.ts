// src/services/GarbageCollector.ts

import cron from 'node-cron';
import { exec } from 'child_process';
import util from 'util';

// Promisify exec so we can use async/await instead of callbacks
const execPromise = util.promisify(exec);

export class GarbageCollector {
  
  /**
   * Initializes the background jobs to keep the server disk clean.
   * Call this once when your Express/Fastify server starts up.
   */
  public static init() {
    console.log('🧹 Garbage Collector initialized.');

    // Schedule: Run every night at 2:00 AM server time
    cron.schedule('0 2 * * *', async () => {
      console.log('🧹 [CRON] Starting nightly Docker garbage collection...');
      await this.runCleanup();
    });
  }

  /**
   * The actual cleanup logic. Can also be triggered manually via a protected Admin API endpoint.
   */
  public static async runCleanup() {
    try {
      // 1. Prune dangling images (the <none>:<none> images)
      // -f forces it without asking for y/n confirmation
      const { stdout: imgOut } = await execPromise('docker image prune -f');
      console.log(`[Images] ${imgOut.trim()}`);

      // 2. Prune BuildKit builder cache 
      // Keep the last 24 hours of cache to keep builds fast, delete anything older
      const { stdout: buildOut } = await execPromise('docker builder prune -f --filter "until=24h"');
      console.log(`[Builder] ${buildOut.trim()}`);

      // 3. Prune stopped containers (in case a build crashed and left a dead container)
      const { stdout: containerOut } = await execPromise('docker container prune -f --filter "until=24h"');
      console.log(`[Containers] ${containerOut.trim()}`);

      console.log('✨ Garbage collection completed successfully.');
      
    } catch (error: any) {
      console.error('🚨 Garbage collection failed:', error.message);
    }
  }
}