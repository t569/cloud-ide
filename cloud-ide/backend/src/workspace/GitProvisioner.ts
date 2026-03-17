// src/workspace/GitProvisioner.ts

// clones our repo into a local environment

import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';

export class GitProvisioner {
  /**
   * Securely provisions a physical volume and clones a repository into it.
   * * @param repoUrl The HTTPS URL of the Git repository.
   * @param mountPath The absolute path on the host server for this session.
   */
  public static async cloneRepository(repoUrl: string, mountPath: string): Promise<void> {
    console.log(`\x1b[36m[Provisioner]\x1b[0m Preparing physical volume at ${mountPath}...`);

    try {
      // 1. The Clean Slate Protocol
      // If the OS crashed previously and left a corrupted folder behind,
      // Git will fatally crash if it tries to clone into a non-empty directory.
      // We ruthlessly wipe the path first, then recreate it.
      await fs.rm(mountPath, { recursive: true, force: true });
      await fs.mkdir(mountPath, { recursive: true });

      // 2. Configure the Git Sandbox
      const options: Partial<SimpleGitOptions> = {
        baseDir: mountPath,
        binary: 'git',
        maxConcurrentProcesses: 1, // Prevent CPU spikes if multiple users boot at once
      };

      const git: SimpleGit = simpleGit(options);

      // 3. Execute the Clone
      console.log(`\x1b[36m[Provisioner]\x1b[0m Pulling repository: ${repoUrl}`);
      
      // We pass '.' as the second argument so it clones directly into the mountPath
      // rather than creating a subfolder with the repo's name.
      await git.clone(repoUrl, '.');

      console.log(`\x1b[36m[Provisioner]\x1b[0m Repository successfully mounted.`);

    } catch (error: any) {
      console.error(`\x1b[31m[Provisioner Fatal]\x1b[0m Failed to clone: ${error.message}`);
      // We throw the error up the chain so the bootloader knows to abort the container
      throw new Error(`Git provisioner failed: ${error.message}`);
    }
  }
}