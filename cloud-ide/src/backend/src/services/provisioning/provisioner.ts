// backend/src/services/provisioning/provisioner.ts

// this file uses various provisioning strategies to set up a mount

import { SandboxSpec } from '@cloud-ide/shared';
import { IProvisioningStrategy } from './IProvisioningStrategy';


// the general class we export and use
// takes in the value of a mounting strategy e.g. git | local
export class WorkspaceProvisioner {
  private strategy: IProvisioningStrategy | null;

  constructor(strategy?: IProvisioningStrategy) {
    this.strategy = strategy || null;
  }

  /**
   * Applies any necessary volume mounts or env vars before booting.
   */
  public prepareSpec(baseSpec: SandboxSpec): SandboxSpec {
    if (!this.strategy) return baseSpec;
    return this.strategy.mutateSpec(baseSpec);
  }
}