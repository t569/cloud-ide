// backend/src/services/storage/WorktreeEngine.ts

import {exec} from 'child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';


const execAsync = promisify(exec);

export class WorktreeEngine {
    constructor(private baseRepoPath: string,
                private worktreesRoot: string
    ) {}

    /**
     * Bootstraps the central bare repository if it doesn't exist.
     * This must be called when the Node.js server starts.
     */
    public async initializeBaseRepo(): Promise<void> {
        try {
            await fs.access(this.baseRepoPath);
            console.log(`[WorktreeEngine] Base repository verified at ${this.baseRepoPath}`);
        } catch {
            console.log(`[WorktreeEngine] Initializing central bare repository...`);
            await fs.mkdir(this.baseRepoPath, { recursive: true });

            // 1. Initialize bare repo
            await execAsync('git init --bare', { cwd: this.baseRepoPath });

            // 2. Git worktrees require an initial commit to branch from.
            // We create a temporary dummy clone, commit, push, and delete it.
            const tmpDir = path.join(this.worktreesRoot, '_bootstrap_tmp');
            await execAsync(`git clone ${this.baseRepoPath} ${tmpDir}`);
            await execAsync('git commit --allow-empty -m "system: initial commit"', { cwd: tmpDir });
            await execAsync('git push origin HEAD', { cwd: tmpDir });
            await fs.rm(tmpDir, { recursive: true, force: true });


            console.log(`[WorktreeEngine] Base repository bootstrap complete.`);
        }
    }

    /**
     * Provisions a lightweight Git worktree for a specific sandbox.
     * @param sandboxId The unique ID to name the folder and branch.
     * @returns The absolute host path to the new worktree.
     */
   public async createWorktree(sandboxId: string): Promise<string> {
        const targetPath = path.join(this.worktreesRoot, sandboxId);
        const branchName = `sbx-${sandboxId}`;

        try {
        await fs.mkdir(this.worktreesRoot, { recursive: true });

        // 1a. Idempotency Check: Check if worktree directory already exists.
        // This is what lets SandboxManager.recover() re-boot a container onto an
        // existing workspace — the files are right here and must be left untouched.
        try {
            await fs.access(targetPath);
            console.log(`[WorktreeEngine] Worktree for ${sandboxId} already exists. Reusing path.`);
            return targetPath;
        } catch {
            // Directory does not exist, proceed to create
        }

        // Drop any stale administrative entry for a checkout that no longer exists,
        // or `worktree add` refuses the path.
        await execAsync('git worktree prune', { cwd: this.baseRepoPath }).catch(() => {});

        // The branch OUTLIVES the checkout (see removeWorktree — we no longer delete
        // it), so it may already exist: the directory was removed but the commits were
        // not. `add -b` would fail on that ("branch already exists"), which would break
        // the one path whose whole job is not to lose a workspace. Check out the
        // EXISTING branch instead — which also restores the committed files, turning a
        // lost checkout into a recoverable one rather than a fatal error.
        const branchExists = await execAsync(
            `git show-ref --verify --quiet refs/heads/${branchName}`,
            { cwd: this.baseRepoPath },
        ).then(() => true).catch(() => false);

        if (branchExists) {
            console.log(`[WorktreeEngine] Branch ${branchName} survives; restoring its checkout.`);
            await execAsync(`git worktree add ${targetPath} ${branchName}`, { cwd: this.baseRepoPath });
        } else {
            await execAsync(`git worktree add -b ${branchName} ${targetPath}`, {
                cwd: this.baseRepoPath,
            });
        }
        return targetPath;
        } catch (error: any) {
        throw new Error(`Failed to provision worktree: ${error.message}`);
        }
    }
    

    /**
     * Resolves the absolute host path of a sandbox's worktree.
     * Single source of truth for the worktree layout — nothing outside this
     * class should join paths under `worktreesRoot` itself.
     */
    public getWorktreePath(sandboxId: string): string {
        return path.join(this.worktreesRoot, sandboxId);
    }

    /**
     * Returns true if the worktree has uncommitted changes (staged, unstaged, or untracked).
     * A missing worktree directory is treated as clean — there is nothing to lose.
     */
    public async isDirty(sandboxId: string): Promise<boolean> {
        const targetPath = path.join(this.worktreesRoot, sandboxId);
        try {
            await fs.access(targetPath);
        } catch {
            return false;
        }

        const { stdout } = await execAsync('git status --porcelain', { cwd: targetPath });
        return stdout.trim().length > 0;
    }

    /**
    * Removes the worktree's CHECKOUT from disk, and nothing more.
    *
    * The branch `sbx-<id>` is deliberately KEPT. It used to be deleted here ("to keep
    * the repo clean"), which quietly made this the most destructive call in the system:
    * the branch is the only durable record of the sandbox's commits, so deleting it
    * left them unreachable and due for gc. Committing your work — the thing you do to
    * make it safe — is what made the worktree clean, which is exactly the condition
    * under which destroy() proceeds to call this. So the safe habit was the one that
    * lost the history.
    *
    * A dangling branch costs a ref and whatever its objects weigh. That is the correct
    * price for being able to answer "where did my work go?" with `git branch --list
    * 'sbx-*'` instead of a shrug.
    * ponytail: no branch reaping. If the ref count ever actually matters, reap on an
    * explicit age policy — never as a side effect of tearing a container down.
    */
    public async removeWorktree(sandboxId: string): Promise<void> {
        const targetPath = path.join(this.worktreesRoot, sandboxId);
        try {
        await execAsync(`git worktree remove -f ${targetPath}`, { cwd: this.baseRepoPath });
        } catch (error: any) {
        console.warn(`[WorktreeEngine] Worktree removal failed gracefully: ${error.message}`);
        await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
        // The checkout is gone but git still has it registered; prune the stale
        // administrative entry so a later worktree can reuse the path. This does NOT
        // touch the branch.
        await execAsync('git worktree prune', { cwd: this.baseRepoPath }).catch(() => {});
        }
    }
}




