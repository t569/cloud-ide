// backend/src/services/provisioning/strategies/local.ts

import { IProvisioningStrategy } from '../IProvisioningStrategy';
import { SandboxSpec } from '@cloud-ide/shared';
import { OpenSandboxExecClient } from '../../sandbox/drivers/opensandbox/execdriver';

export class LocalMountStrategy implements IProvisioningStrategy {
  constructor(
    private hostPath: string,
    private mountPath: string = '/workspace'
  ) {}

  public mutateSpec(spec: SandboxSpec): SandboxSpec {
    // We modify the infrastructure request BEFORE it hits OpenSandbox
    const modifiedSpec = { ...spec };
    modifiedSpec.volumes = modifiedSpec.volumes || [];
    
    modifiedSpec.volumes.push({
      name: 'local-workspace-bind',
      hostPath: this.hostPath,
      mountPath: this.mountPath,
      readOnly: false // Allow the IDE to write back to the local host folder
    });

    return modifiedSpec;
  }

  public async executePostBoot(execClient: OpenSandboxExecClient): Promise<void> {
    // The folder is already mounted by the container engine at boot time.
    // No post-boot commands are necessary.
    return Promise.resolve();
  }
}