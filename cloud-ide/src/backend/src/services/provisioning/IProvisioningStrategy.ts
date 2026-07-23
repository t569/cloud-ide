// backend/src/services/provisioning/IProvisioningStrategy.ts


// How a workspace's storage gets into a sandbox: the strategy injects its volume into the
// spec BEFORE the container boots.
//
// There was a second hook here, executePostBoot, for strategies that had to run commands
// inside a running container (the idea being local mounts inject before boot, a git clone
// after). Nothing ever called it — the only implementation was a no-op, because a worktree
// is bind-mounted already populated and a clone happens host-side. Deleted rather than
// carried: an unused hook is not a seam, it is a second way to do something that only
// happens one way.

import { SandboxSpec } from '@cloud-ide/shared';

export interface IProvisioningStrategy {
  /** Inject volumes or env vars into the spec before the container boots. */
  mutateSpec(spec: SandboxSpec): SandboxSpec;
}