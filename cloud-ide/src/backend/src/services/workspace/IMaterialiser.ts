// backend/src/services/workspace/IMaterialiser.ts
//
// The seam that turns a WORKSPACE (its durable form) into a mounted /workspace for one
// sandbox, and tears it back down (docs/plans/workspace-entity.md, Decision 2). Mirrors
// the provisioning-strategy seam: SandboxManager depends on this interface, not a concrete
// materialiser, so the FAST path (overlayfs CoW — Phase 3, spike passed) can drop in
// beside the portable git-checkout one below with no core change.

import { WorkspaceRecord } from '../../database/models';
import { GitAuth } from '../storage/WorktreeEngine';

export interface MaterialiseRequest {
  workspace: WorkspaceRecord;
  /** The on-disk checkout id (the sandbox's worktreeId) to materialise into. */
  worktreeId: string;
  /** True on a cold provision, false when RECOVERING onto an existing checkout (reuse,
   *  never re-clone). Gates whether a git-url source is cloned or the checkout reused. */
  fresh: boolean;
  /** Credential for a private git-url source. */
  auth?: GitAuth;
}

export interface IMaterialiser {
  /** Produce the host path to mount at /workspace for this sandbox. */
  materialise(req: MaterialiseRequest): Promise<string>;
  /** Tear down a sandbox's checkout. The workspace's durable form is untouched. */
  dematerialise(worktreeId: string): Promise<void>;
}
