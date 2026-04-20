// backend/src/services/provisioning/strategies/git/WorktreeStrategy.ts

import { IProvisioningStrategy } from '../../IProvisioningStrategy';
import { SandboxSpec } from '@cloud-ide/shared/types/sandbox';
import { OpenSandboxExecClient } from '../../../sandbox/drivers/opensandbox/execdriver';

export class WorktreeStrategy implements IProvisioningStrategy {
  constructor(
    private hostPath: string,
    private mountPath: string = '/workspace' // Mount directly to the core workspace
  ) {}

  public mutateSpec(spec: SandboxSpec): SandboxSpec {
    const modifiedSpec = { ...spec };
    modifiedSpec.volumes = modifiedSpec.volumes || [];
    
    // Inject the host SSD worktree path into the container
    modifiedSpec.volumes.push({
      name: 'git-worktree-workspace',
      kind: 'workspace',
      hostPath: this.hostPath,
      mountPath: this.mountPath,
      readOnly: false 
    });

    return modifiedSpec;
  }

  public async executePostBoot(execClient: OpenSandboxExecClient): Promise<void> {
    // Because the files live on the host and were mounted at boot by Docker,
    // we do NOT need to run `git clone` inside the container!
    // The workspace is instantly ready with zero network overhead.
    return Promise.resolve();
  }
}