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
        
        // 1a. Idempotency Check: Check if worktree directory already exists
        try {
            await fs.access(targetPath);
            console.log(`[WorktreeEngine] Worktree for ${sandboxId} already exists. Reusing path.`);
            return targetPath;
        } catch {
            // Directory does not exist, proceed to create
        }

        await execAsync(`git worktree add -b ${branchName} ${targetPath}`, { 
            cwd: this.baseRepoPath 
        });
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
    * Safely deletes the worktree from the disk and the Git tracking database.
    */

    public async removeWorktree(sandboxId: string): Promise<void> {
        const targetPath = path.join(this.worktreesRoot, sandboxId);
        try {
        await execAsync(`git worktree remove -f ${targetPath}`, { cwd: this.baseRepoPath });
        // Also delete the branch to keep repo clean
        await execAsync(`git branch -D sbx-${sandboxId}`, { cwd: this.baseRepoPath }).catch(() => {});
        } catch (error: any) {
        console.warn(`[WorktreeEngine] Worktree removal failed gracefully: ${error.message}`);
        await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
        }
    }
}




