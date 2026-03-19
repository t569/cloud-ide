// backend/src/services/WorkspaceProvisioner.ts


import { config } from '../config/env';

/**
 * The standard interface every provisioning strategy must follow.
 */
export interface ProvisioningStrategy {
  // Returns any Docker volumes that must be attached BEFORE the container boots

  // we have the hostpath the volume to be injected and container path the location to inject it into
  getVolumes(): any[];
  
  // Executes shell commands INSIDE the container AFTER it boots
  postBootSetup(sandboxId: string, apiUrl: string): Promise<void>;
}

/**
 * Strategy 1: The Local Host Cache (Bind Mounts)
 * Best for local development and instant syncing.
 */
export class LocalBindStrategy implements ProvisioningStrategy {
  private localPath: string;

  constructor(localPath: string) {
    this.localPath = localPath;
  }


  public getVolumes() {
    return [
      {
        hostPath: this.localPath,
        containerPath: "/workspace",
        readOnly: false
      }
    ];
  }

  public async postBootSetup(sandboxId: string, apiUrl: string) {
    // The files are already physically mounted by Docker at boot. 
    // No post-boot commands are necessary!
    console.log(`\x1b[36m[Provisioner]\x1b[0m Local volume mounted at ${this.localPath}`);
    return;
  }
}

/**
 * Strategy 2: The Git Clone Provisioner
 * Best for fresh, isolated cloud sessions.
 */
export class GitStrategy implements ProvisioningStrategy {
  private repoUrl: string;

  constructor(repoUrl: string) {
    this.repoUrl = repoUrl;
  }

  public getVolumes() {
    // We don't mount local files; we want an empty, isolated container
    return []; 
  }

  public async postBootSetup(sandboxId: string, apiUrl: string) {
    console.log(`\x1b[36m[Provisioner]\x1b[0m Injecting Git repository: ${this.repoUrl}`);
    
    // We use OpenSandbox's exec API to force the container to clone the repo 
    // directly into the current directory (/workspace)
    const response = await fetch(`${apiUrl}/api/sandbox/${sandboxId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: ['/bin/sh', '-c', `git clone ${this.repoUrl} .`] 
      })
    });

    if (!response.ok) {
      throw new Error(`Git provisioner failed to reach engine: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Git clone failed inside container: ${data.stderr}`);
    }

    console.log(`\x1b[32m[Provisioner]\x1b[0m Repository successfully cloned into workspace.`);
  }
}

/**
 * The Main Provisioner Service
 * This wraps whatever strategy we choose to use for a specific session.
 */
export class WorkspaceProvisioner {
  private strategy: ProvisioningStrategy;

  constructor(strategy: ProvisioningStrategy) {
    this.strategy = strategy;
  }

  public getBootVolumes() {
    return this.strategy.getVolumes();
  }

  public async runPostBoot(sandboxId: string) {
    await this.strategy.postBootSetup(sandboxId, config.OPENSANDBOX_API_URL);
  }
}