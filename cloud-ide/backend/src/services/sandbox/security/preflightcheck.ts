// backend/src/services/sandbox/security/preflightchecks.ts

import { OpenSandboxExecClient } from '../drivers/opensandbox/execdriver';

// make sure we dont delete a sandbox with active git changes

// NOTE: run this check when DELETE /api/v1/sandboxes/:id is called and return a 409 conflict
// Message: "You have uncommitted changes. Please commit, stash, or pass ?force=true to override."

export class PreFlightChecks {
  
  /**
   * Checks if the /workspace directory has uncommitted Git changes.
   * Returns true if safe to delete (clean), false if there are uncommitted changes (dirty).
   */
  public static async isGitWorkspaceClean(ipAddress: string, execdPort: number): Promise<boolean> {
    const execClient = new OpenSandboxExecClient(ipAddress, execdPort);

    return new Promise((resolve, reject) => {
      // --porcelain outputs nothing if the working tree is clean.
      // If there are changes, it outputs a list of modified/untracked files.
      const command = `cd /workspace && if [ -d .git ]; then git status --porcelain; else echo "NOT_GIT"; fi`;
      
      let output = '';

      execClient.run({ command })
        .on('stdout', (data) => { output += data.toString(); })
        .on('error', (err) => reject(new Error(`Pre-flight check failed: ${err.message}`)))
        .on('exit', (code) => {
          if (code !== 0) {
            return reject(new Error(`Git status check exited with code ${code}`));
          }
          
          const cleanOutput = output.trim();
          
          // If it's not a git repo, there's nothing to commit. Safe to delete (or rely on volume persistence).
          if (cleanOutput === "NOT_GIT") return resolve(true);
          
          // If output is completely empty, the working tree is clean.
          if (cleanOutput === "") return resolve(true);

          // Otherwise, we have uncommitted changes.
          resolve(false);
        });
    });
  }
}