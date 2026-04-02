// server/services/BuilderService.ts
import { spawn } from 'child_process';
import { DockerGenerator } from '@cloud-ide/shared/utils/dockergen';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

export class BuilderService {
  /**
   * Generates the Dockerfile and streams it to Docker BuildKit
   */
  public static async buildImage(config: EnvironmentConfig, imageTag: string): Promise<void> {
    // TODO: we need to find a wayto inject other dependencies from drivers e.g. opensandbox exec here
    const report = DockerGenerator.generate(config, { optimize: true });
    
    console.log(`[Builder] Starting build for ${imageTag}. Estimated size: ${report.estimatedSizeMb}MB`);

    return new Promise((resolve, reject) => {
      // DOCKER_BUILDKIT=1 is required for the caching mounts we added
      const buildProcess = spawn('docker', [
        'build',
        '-t', imageTag,
        '-', // The hyphen tells Docker to read the Dockerfile from stdin
      ], {
        env: { ...process.env, DOCKER_BUILDKIT: '1' }
      });

      // Pipe our generated Dockerfile string directly into the build process
      buildProcess.stdin.write(report.dockerfile);
      buildProcess.stdin.end();

      // Stream the build logs to your server console (or push to a UI WebSocket)
      buildProcess.stdout.on('data', (data) => {
        process.stdout.write(`[Docker] ${data}`);
      });

      buildProcess.stderr.on('data', (data) => {
        process.stderr.write(`[Docker Error/Warn] ${data}`);
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`[Builder] Successfully built ${imageTag}`);
          resolve();
        } else {
          reject(new Error(`Docker build failed with exit code ${code}`));
        }
      });
    });
  }
}