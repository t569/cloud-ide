// backend/src/services/provisioning/strategies/git.ts


// strategy to inject git repo after boot up of sandbox

// TODO; we need to handle a case where we try terminating a sandbox when our work tree isnt clean
import { IProvisioningStrategy } from '../IProvisioningStrategy';
import { SandboxSpec } from '@cloud-ide/shared';
import { OpenSandboxExecClient } from '../../sandbox/drivers/opensandbox/execdriver';



export class GitStrategy implements IProvisioningStrategy {
  constructor(
    private repoUrl: string,
    private branch?: string
  ) {}

  public mutateSpec(spec: SandboxSpec): SandboxSpec {
    // Git cloning requires no pre-boot infrastructure changes.
    // The container just boots empty.
    return spec;
  }

  public async executePostBoot(execClient: OpenSandboxExecClient): Promise<void> {
    return new Promise((resolve, reject) => {
      const branchFlag = this.branch ? `-b ${this.branch}` : '';
      
      // We wipe the /workspace directory in case the base image had default files,
      // then clone directly into it.
      const command = `rm -rf /workspace/* && git clone ${branchFlag} ${this.repoUrl} /workspace`;
      

      // stream our events with both an event listener and a valid return object
      execClient.run({ command })
      .on('stdout', (data) => console.log(`[Git] ${data}`))
      .on('error', (err) => reject(new Error(`'Execution failed: ${err.mesage}`)))
      .on('exit', (code) =>{
        if(code === 0) resolve();
        else reject(new Error(`Git clone exited with code ${code}`))
      });
    });
  }
}