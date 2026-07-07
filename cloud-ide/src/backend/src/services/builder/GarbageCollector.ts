// src/services/GarbageCollector.ts

import cron from 'node-cron';
import { DockerCli } from '../docker';

export class GarbageCollector {
  // Shared, argv-based docker wrapper (no shell → the --filter values can't be
  // reinterpreted by a shell). Static API kept for the existing server.ts call.
  private static readonly docker = new DockerCli();

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
      // 1. Prune dangling images (the <none>:<none> images). -f skips the y/n prompt.
      const img = await this.docker.run(['image', 'prune', '-f']);
      console.log(`[Images] ${img.stdout.trim()}`);

      // 2. Prune BuildKit builder cache, keeping the last 24h so builds stay fast.
      const builder = await this.docker.run(['builder', 'prune', '-f', '--filter', 'until=24h']);
      console.log(`[Builder] ${builder.stdout.trim()}`);

      // 3. Prune stopped containers (e.g. a crashed build left a dead container).
      const container = await this.docker.run(['container', 'prune', '-f', '--filter', 'until=24h']);
      console.log(`[Containers] ${container.stdout.trim()}`);

      console.log('✨ Garbage collection completed successfully.');
    } catch (error: any) {
      console.error('🚨 Garbage collection failed:', error.message);
    }
  }
}