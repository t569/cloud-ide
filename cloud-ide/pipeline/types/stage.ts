// pipeline/types/stage.ts
import { BuildStep } from '../../shared/types/env';

/**
 * Defines the role of the stage in the Dockerfile.
 * - 'builder': Heavyweight image containing compilers, caches, and dev headers.
 * - 'runtime': Lightweight/slim image containing only the executable artifacts.
 */
export type StageRole = 'builder' | 'runtime';

/**
 * Represents a file or directory that needs to be moved from one stage to another.
 * This translates to: COPY --from=<sourceStage> <sourcePath> <destinationPath>
 */
export interface ArtifactTransfer {
  sourceStage: string;    // The name of the stage to copy from (e.g., 'builder')
  sourcePath: string;     // The absolute path in the builder (e.g., '/workspace/api/node_modules')
  destinationPath: string;// The absolute path in the runtime image
}

/**
 * The master representation of a single Docker build stage (e.g., FROM base AS name).
 */
export interface DockerStage {
  name: string;           // e.g., 'builder' or 'final'
  role: StageRole;        
  baseImage: string;      // e.g., 'node:18-bullseye' (builder) vs 'node:18-alpine' (runtime)
  
  steps: BuildStep[];     // The filtered list of steps that belong to THIS stage
  envVars: Record<string, string>; // Environment variables injected into this stage
  
  // Artifacts to copy IN to this stage from previous stages
  inboundArtifacts: ArtifactTransfer[]; 

  entrypoint?: string[];     // Optional: The command to run when the container starts (e.g., 'node server.js')
                            // e.g. ["/bin/bash", "-c"]
  cmd?: string[];           // Optional: Arguments for the entrypoint (e.g., ["npm", "start"])
                            // e.g. ["/usr/local/bin/execd", "--port", "2222"]
    
}

/**
 * The final payload that the Assembler will use to generate the Dockerfile string.
 */
export interface PipelineManifest {
  stages: DockerStage[];
  globalEnv: Record<string, string>; 
  bootUpAsRoot: boolean;
}