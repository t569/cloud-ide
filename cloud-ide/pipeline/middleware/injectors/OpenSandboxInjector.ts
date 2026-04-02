// pipeline/middleware/injectors/OpenSandboxInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';

export class OpenSandboxInjector implements PipelineInjector {
  name = 'OpenSandboxIntegration';
  description = 'Injects the OpenSandbox execd daemon and configures the container boot sequence.';

  inject(manifest: PipelineManifest): PipelineManifest {
    const runtimeStage = manifest.stages.find(stage => stage.role === 'runtime');
    
    if (!runtimeStage) {
       throw new Error("OpenSandboxInjector requires a 'runtime' stage to exist.");
    }

    // 1. Install the Daemon
    // We add this to the end of the build steps so it doesn't interfere with user packages
    runtimeStage.steps.push({
      name: 'Install execd Daemon',
      type: 'shell',
      // Assuming the install script drops the binary at /usr/local/bin/execd
      command: 'curl -sSL https://proxy.opensandbox.com/install-execd.sh | bash', 
      isGlobal: true
    });

    // 2. Inject Required Environment Variables
    manifest.globalEnv['SANDBOX_MODE'] = 'interactive';
    manifest.globalEnv['EXECD_PORT'] = '2222';

    // 3. THE CRITICAL ADDITION: Hijack the Boot Sequence
    // We set the daemon to run automatically when the container starts.
    // If we don't do this, the container might just exit immediately.
    runtimeStage.cmd = [
      '/usr/local/bin/execd', 
      '--port', '2222', 
      '--workspace', '/workspace'
    ];

    return manifest;
  }
}