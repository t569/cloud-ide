// backend/src/services/workspace/GitCheckoutMaterialiser.ts
//
// The PORTABLE materialiser (workspace-entity.md, Decision 2): a plain git worktree
// checkout, delegating to WorktreeEngine. Chosen as the first impl because it works on any
// filesystem and reproduces exactly what provision() does today — proving the seam with
// zero behavioural change. The overlayfs CoW materialiser (Phase 3) is the fast path that
// drops in beside it later.
//
// ponytail: Phase 2 keeps today's per-sandbox checkout model — a git-url source clones
// straight into the checkout (reproducing clone-on-create). The durable-ref fork
// (Decision 5) and save-to-ref (Phase 4) land later; until then a "workspace" is still
// materialised as one checkout, just behind the seam.

import { IMaterialiser, MaterialiseRequest } from './IMaterialiser';
import { WorktreeEngine } from '../storage/WorktreeEngine';

export class GitCheckoutMaterialiser implements IMaterialiser {
  constructor(private worktrees: WorktreeEngine) {}

  public async materialise({ workspace, worktreeId, fresh, auth }: MaterialiseRequest): Promise<string> {
    // A fresh git-url workspace is cloned into its checkout; a blank one gets an empty
    // checkout; a recovery (fresh === false) reuses the existing checkout untouched.
    if (fresh && workspace.source === 'git-url' && workspace.sourceUrl) {
      return this.worktrees.cloneInto(worktreeId, workspace.sourceUrl, auth);
    }
    return this.worktrees.createWorktree(worktreeId);
  }

  public dematerialise(worktreeId: string): Promise<void> {
    return this.worktrees.removeWorktree(worktreeId);
  }
}
