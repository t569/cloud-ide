// pipeline/middleware/types.ts
import { PipelineManifest, DockerStage } from '../types/stage';

/**
 * The core contract for any middleware plugin.
 * It takes a manifest, mutates it, and returns it.
 */
export interface PipelineInjector {
  name: string;
  description: string;
  
  /**
   * Mutates the manifest before it gets compiled into Dockerfile syntax.
   */
  inject(manifest: PipelineManifest): PipelineManifest;
}