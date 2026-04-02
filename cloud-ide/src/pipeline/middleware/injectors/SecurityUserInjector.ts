// pipeline/middleware/injectors/SecurityUserInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';

export class SecurityUserInjector implements PipelineInjector {
  name = 'NonRootSecurityPolicy';
  description = 'Creates a restricted user and drops root privileges if requested.';

  inject(manifest: PipelineManifest): PipelineManifest {
    // If the user specifically wants root, bypass this policy
    if (manifest.bootUpAsRoot) return manifest;

    const runtimeStage = manifest.stages.find(stage => stage.role === 'runtime');
    if (!runtimeStage) return manifest;

    // Inject user creation before any local workspace builds occur
    runtimeStage.steps.unshift({
      name: 'Create Restricted Sandbox User',
      type: 'shell',
      command: 'useradd -m -s /bin/bash sandbox-user && chown -R sandbox-user:sandbox-user /workspace',
      isGlobal: true
    });

    // Note: The actual "USER sandbox-user" Docker command will be handled 
    // by the Final Assembler reading the bootUpAsRoot flag, this just preps the OS.

    return manifest;
  }
}