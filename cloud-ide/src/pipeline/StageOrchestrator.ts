// pipeline/StageOrchestrator.ts

/* this module is responsible for taking the raw EnvironmentConfig
    * and transforming it into a structured PipelineManifest
    * that defines the builder and runtime stages, routes build steps appropriately,
    * and registers artifact transfers. */

import { EnvironmentConfig, BuildStep } from '../shared/types/env';
import { PipelineManifest, DockerStage, ArtifactTransfer } from './types/stage';

export class StageOrchestrator {
  
  public static generateManifest(config: EnvironmentConfig): PipelineManifest {
    const builderSteps: BuildStep[] = [];
    const runtimeSteps: BuildStep[] = [];
    const systemSteps: BuildStep[] = []; // NEW: Steps both stages need
    const transfers: ArtifactTransfer[] = [];

    const builderImage = config.baseImage;
    // Runtime reuses the exact base the builder already pulled. We used to append
    // "-slim" here, but that fabricated tags Docker Hub doesn't have (python:latest-slim,
    // ubuntu:22.04-slim, python:slim), so the runtime FROM failed to pull. If a smaller
    // runtime is wanted, set baseImage to a real slim/alpine tag explicitly.
    const runtimeImage = config.baseImage;

    // 1. Step Routing
    for (const step of config.buildSteps) {
      if (step.type === 'apt') {
        // System packages are required by BOTH the builder (for compiling) 
        // and the runtime (for general sandbox usage).
        systemSteps.push(step);
      } else if (this.isBuilderStep(step)) {
        builderSteps.push(step);

        if (step.targetPath && step.isGlobal === false) {
          const pathExists = transfers.some(t => t.sourcePath === step.targetPath);
          if (!pathExists) {
            transfers.push({
              sourceStage: 'builder',
              sourcePath: step.targetPath,
              destinationPath: step.targetPath
            });
          }
        }
      } else {
        runtimeSteps.push(step);
      }
    }

    // 2. The "Single Stage" Optimization bypass
    if (builderSteps.length === 0) {
      return {
        stages: [{
          name: 'runtime', // Just a single stage
          role: 'runtime',
          baseImage: builderImage, // Keep the original base image
          steps: [...systemSteps, ...runtimeSteps],
          envVars: config.env || {},
          inboundArtifacts: []
        }],
        globalEnv: config.env || {},
        bootUpAsRoot: config.bootUpAsRoot ?? false
      };
    }

    // 3. Multi-Stage Construction
    const builderStage: DockerStage = {
      name: 'builder',
      role: 'builder',
      baseImage: builderImage,
      steps: [...systemSteps, ...builderSteps], // Inject system dependencies first
      envVars: config.env || {},
      inboundArtifacts: []
    };

    const runtimeStage: DockerStage = {
      name: 'runtime',
      role: 'runtime',
      baseImage: runtimeImage,
      steps: [...systemSteps, ...runtimeSteps], // Inject system dependencies first
      envVars: config.env || {},
      inboundArtifacts: transfers 
    };

    return {
      stages: [builderStage, runtimeStage],
      globalEnv: config.env || {},
      // Default NON-root (Phase 3, sandbox-privileges.md): least privilege for untrusted
      // code, and the thing that lets pulseaudio/display audio run. Engages
      // SecurityUserInjector + the assembler's `USER sandbox-user`. An env can still opt
      // back into root with an explicit `bootUpAsRoot: true` (build steps needing root at
      // RUNTIME, or an exotic base without useradd/adduser). The content tag tracks the
      // generated Dockerfile, so this flip rebuilds existing envs correctly on next build.
      bootUpAsRoot: config.bootUpAsRoot ?? false
    };
  }

  private static isBuilderStep(step: BuildStep): boolean {
    const heavyBuilders = ['npm', 'cargo', 'go', 'zig', 'maven', 'gradle', 'pip'];
    if (heavyBuilders.includes(step.type) && step.isGlobal === false) return true;
    if (step.type === 'shell' && step.targetPath) return true;
    return false;
  }
}