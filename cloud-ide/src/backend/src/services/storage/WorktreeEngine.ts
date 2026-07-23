// backend/src/services/storage/WorktreeEngine.ts

import {exec, execFile} from 'child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';


const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface GitStatusEntry {
  /** Two-char porcelain XY code (e.g. ' M', 'A ', '??', 'R '). */
  status: string;
  path: string;
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  /** ISO-8601 author date. */
  date: string;
}

export interface GitAuth {
  /** GitHub PAT (or app token). Sent as the HTTP Basic password. */
  token: string;
  /** Remote host to scope the credential to. Defaults to 'github.com'. */
  host?: string;
}

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
            await this.makeContainerWritable(targetPath); // a recovered non-root sandbox needs it too
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
        await this.makeContainerWritable(targetPath);
        return targetPath;
        } catch (error: any) {
        throw new Error(`Failed to provision worktree: ${error.message}`);
        }
    }

    /**
     * Grant the non-root sandbox user write access to its worktree (Phase 2 of the
     * non-root workstream — docs/plans/sandbox-privileges.md).
     *
     * The gateway (and its `git`) run as ROOT, so a fresh checkout is root-owned 0644. A
     * non-root container (bootUpAsRoot:false ⇒ sandbox-user, uid 1000) then gets a
     * READ-ONLY workspace — it can't `npm install`, write build output, or save from a
     * terminal editor. `a+rwX` opens the tree to the container user (`X` adds +x on
     * directories and already-executable files only) while leaving it root-OWNED, so the
     * gateway's own root `git` sees no ownership change (no "dubious ownership"). Same
     * permissive, single-tenant posture as the 0777 package-cache mount (cacheVolumes.ts),
     * and a no-op for root sandboxes (root ignores perms).
     *
     * ponytail: this covers the INITIAL checkout. Files the gateway CREATES afterward (git
     * commits, brand-new IDE files) come back root-owned 0644 — full read/write parity for
     * in-container `git`/editing needs the deeper uid reconciliation (run gateway ops as the
     * container uid, or a non-root gateway). Tracked as Phase 2.1 in the plan.
     */
    private async makeContainerWritable(targetPath: string): Promise<void> {
        await execAsync(`chmod -R a+rwX '${targetPath}'`).catch((e: any) =>
            console.warn(`[WorktreeEngine] Could not open worktree perms for ${targetPath}: ${e.message}`),
        );
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

    // ─── Git operations on a sandbox's worktree ──────────────────────────────
    //
    // These run REAL git in the worktree the editor and terminal already write to
    // (one source of truth) via execFile — argv, NO shell — because they carry
    // user input (repo URLs, commit messages, branch names). The older exec()
    // methods above interpolate into a shell string; do NOT copy that here.
    // See docs/plans/git-integration.md.

    /** argv, no shell. `auth` (when given) prepends scoped credential config. */
    private git(cwd: string, args: string[], auth?: GitAuth): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', [...this.authArgs(auth), ...args], {
            cwd,
            maxBuffer: 64 * 1024 * 1024,
            // Never fall back to an interactive prompt: a push/pull/clone with missing or
            // wrong credentials must FAIL FAST, not hang the request waiting on a terminal
            // that will never answer (GIT_TERMINAL_PROMPT), and skip any configured GUI
            // credential helper for the same reason (core.askPass + GIT_ASKPASS empty).
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' },
        });
    }

    /**
     * Credential config for network ops. The PAT rides as an Authorization header via
     * command-scoped `-c http.<host>.extraHeader` — it never lands in the remote URL or
     * in .git/config, so it is NOT exposed to the container that mounts the checkout.
     * GitHub accepts a PAT as the Basic password with any username.
     *
     * SCOPED to the remote host (not a bare `http.extraHeader`) so the token is never
     * sent to a third-party host on a redirect or submodule. git exports these `-c`
     * values in GIT_CONFIG_PARAMETERS, so a blobless clone's IMPLICIT lazy blob fetch
     * (spawned inside diff/checkout) inherits them too — private-repo lazy fetch is
     * seamless without persisting anything to disk.
     */
    private authArgs(auth?: GitAuth): string[] {
        if (!auth?.token) return [];
        const basic = Buffer.from(`x-access-token:${auth.token}`).toString('base64');
        const host = auth.host ?? 'github.com';
        return ['-c', `http.https://${host}/.extraHeader=AUTHORIZATION: basic ${basic}`];
    }

    /** Fill in `host` from the clone URL when the caller didn't specify one. */
    private authForUrl(url: string, auth?: GitAuth): GitAuth | undefined {
        if (!auth?.token || auth.host) return auth;
        try {
            return { token: auth.token, host: new URL(url).hostname };
        } catch {
            return auth; // non-URL remote (local path): host default is harmless here
        }
    }

    /**
     * Blobless partial clone into the sandbox's worktree path — lightweight (commit
     * graph + trees, not blobs) with git's native lazy blob fetch. Fails if the path
     * is already a non-empty checkout (use createWorktree's reuse path for that).
     */
    public async cloneInto(sandboxId: string, url: string, auth?: GitAuth): Promise<string> {
        const targetPath = path.join(this.worktreesRoot, sandboxId);
        await fs.mkdir(this.worktreesRoot, { recursive: true });
        // --no-hardlinks: a no-op for remote clones, but a LOCAL source (a repo already on
        // the server's disk — see workspace/localRepo.ts) would otherwise share object-file
        // inodes with its origin. The container mounts this checkout read-write, so a
        // hardlinked .git/objects entry is a write handle into the source repo. Copy instead.
        // `--` keeps a url beginning with `-` from being read as a flag.
        await this.git(this.worktreesRoot, [
            'clone', '--filter=blob:none', '--no-hardlinks', '--', url, targetPath,
        ], this.authForUrl(url, auth));
        await this.makeContainerWritable(targetPath);
        return targetPath;
    }

    /** Parsed `git status` (NUL-delimited, rename-safe). Empty when clean. */
    public async status(sandboxId: string): Promise<GitStatusEntry[]> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        const { stdout } = await this.git(cwd, ['status', '--porcelain=v1', '-z']);
        const parts = stdout.split('\0');
        const out: GitStatusEntry[] = [];
        for (let i = 0; i < parts.length; i++) {
            const entry = parts[i];
            if (!entry) continue;
            const status = entry.slice(0, 2);
            out.push({ status, path: entry.slice(3) });
            // A rename/copy (R*/C*) is followed by its source path as the next segment.
            if (status[0] === 'R' || status[0] === 'C') i++;
        }
        return out;
    }

    /** Stage paths (or everything). Paths are argv, never a glob string. */
    public async stage(sandboxId: string, paths: string[] = ['.']): Promise<void> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        await this.git(cwd, ['add', '--', ...paths]);
    }

    /**
     * Commit staged changes. Identity is passed per-command; not persisted globally.
     *
     * `paths` (when given) commits EXACTLY those paths from the working tree and
     * disregards whatever else is staged — which is what lets the UI offer per-file
     * commits with no unstage/reset endpoint to go with them: nothing the user didn't
     * pick can ride along, so a leftover index entry is never a trap.
     */
    public async commit(
        sandboxId: string,
        message: string,
        author: { name: string; email: string } = { name: 'Cloud IDE', email: 'noreply@cloud-ide' },
        paths?: string[],
    ): Promise<void> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        await this.git(cwd, [
            '-c', `user.name=${author.name}`,
            '-c', `user.email=${author.email}`,
            'commit', '-m', message,
            ...(paths?.length ? ['--', ...paths] : []),
        ]);
    }

    /** Current branch name (e.g. `sbx-<id>` or a cloned repo's default branch). */
    public async currentBranch(sandboxId: string): Promise<string> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        const { stdout } = await this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        return stdout.trim();
    }

    /** Recent commits, newest first. */
    public async log(sandboxId: string, limit = 50): Promise<GitLogEntry[]> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        // NUL between fields, newline between records — neither can appear in a hash,
        // author name is the only risk and %an can't contain NUL.
        const { stdout } = await this.git(cwd, [
            'log', `-n${limit}`, '--format=%H%x00%s%x00%an%x00%aI',
        ]);
        return stdout.split('\n').filter(Boolean).map((line) => {
            const [hash, subject, author, date] = line.split('\0');
            return { hash, subject, author, date };
        });
    }

    /**
     * Unified diff of the worktree against HEAD — staged AND unstaged, i.e. exactly what
     * a commit would capture, which is what the Source Control pane shows. Optionally
     * scoped to one path. Untracked files aren't in HEAD so they diff empty; the pane
     * offers to open those in the editor instead.
     */
    public async diff(sandboxId: string, filePath?: string): Promise<string> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        const args = ['diff', 'HEAD'];
        if (filePath) args.push('--', filePath);
        const { stdout } = await this.git(cwd, args);
        return stdout;
    }

    /** Push the current branch to `origin HEAD`. `auth` needed for private remotes. */
    public async push(sandboxId: string, auth?: GitAuth): Promise<void> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        await this.git(cwd, ['push', 'origin', 'HEAD'], auth);
    }

    /** Pull the current branch from origin (fast-forward + lazy-fetch new blobs). */
    public async pull(sandboxId: string, auth?: GitAuth): Promise<void> {
        const cwd = path.join(this.worktreesRoot, sandboxId);
        await this.git(cwd, ['pull', '--ff-only'], auth);
    }
}




