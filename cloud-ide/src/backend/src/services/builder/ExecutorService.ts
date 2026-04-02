// shared/utils/services/ExecutorService.ts

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { DockerGeneratorService } from './GeneratorService';

export class ExecutorService {
  
  /**
   * Builds the Docker image and returns an event emitter to stream logs.
   */
  public static streamBuild(rawJsonPayload: string, imageTag: string): EventEmitter {
    const logStream = new EventEmitter();

    try {
      // 1. Generate the Dockerfile string
      const dockerfileStr = DockerGeneratorService.generateDockerfile(rawJsonPayload);
      
      logStream.emit('data', 'Initializing Cloud IDE Pipeline...\n');
      logStream.emit('data', 'Dockerfile generated successfully. Starting build daemon...\n');

      // 2. Spawn the Docker Build process
      // '-' tells Docker to read the Dockerfile from standard input (stdin)
      const dockerBuild = spawn('docker', [
        'build',
        '--progress=plain', // CRITICAL: Prevents garbled ANSI progress bars
        '-t', imageTag,
        '-'
      ]);

      // 3. Pipe our generated Dockerfile string into the process
      dockerBuild.stdin.write(dockerfileStr);
      dockerBuild.stdin.end();

      // 4. Stream Stdout (Standard logs)
      dockerBuild.stdout.on('data', (data) => {
        logStream.emit('data', data.toString());
      });

      // 5. Stream Stderr (Docker BuildKit sends normal logs to stderr, not just errors)
      dockerBuild.stderr.on('data', (data) => {
        logStream.emit('data', data.toString());
      });

      // 6. Handle Completion
      dockerBuild.on('close', (code) => {
        if (code === 0) {
          logStream.emit('success', `\nBuild completed successfully. Tagged as ${imageTag}`);
        } else {
          logStream.emit('error', `\nBuild failed with exit code ${code}`);
        }
      });

    } catch (err: any) {
      logStream.emit('error', `Pipeline Error: ${err.message}`);
    }

    return logStream;
  }
}