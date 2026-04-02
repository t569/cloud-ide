// backend/src/services/provisioning/IProvisioningStrategy.ts


// this defines an interface for when to inject volumes

// e.g. localpath: before
// github: after

// TODO: lets talk security later

import { SandboxSpec } from '@cloud-ide/shared';
import { OpenSandboxExecClient } from '../sandbox/drivers/opensandbox/execdriver';

export interface IProvisioningStrategy {
  /**
   * Hook 1: Pre-Boot. 
   * Allows the strategy to inject volumes or environment variables into the spec BEFORE the VM boots.
   */
  mutateSpec(spec: SandboxSpec): SandboxSpec;

  /**
   * Hook 2: Post-Boot.
   * Allows the strategy to run commands inside the container AFTER the VM is running.
   */
  executePostBoot(execClient: OpenSandboxExecClient): Promise<void>;
}