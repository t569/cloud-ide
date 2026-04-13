// backend/src/services/synchronization/syncdaemon.ts

// this synchronises our development environment config file based on new installation commands

import { IFileWatcher } from '@cloud-ide/shared';
import { PackageManagerRules } from '@cloud-ide/shared';
import { OpenSandboxExecClient } from '../sandbox/drivers/opensandbox';
import { EventEmitter } from 'events';

export class SyncDaemon extends EventEmitter implements IFileWatcher{

  // for open sandbox we use the execd command to send commands to the sandbox
  private execClient: OpenSandboxExecClient;

  // a field for keeping track of the folders we are watching
  private workspaces: string[] = [];
  constructor(ipAdress: string, execdPort:number) {
    super();
    this.execClient = new OpenSandboxExecClient(ipAdress, execdPort);
  }

  // we are in essence watching package manager files to see if they changed
  // watching ALL files in the directory
  public startWatching(workspacePath: string = '/workspace') {
    // by dfault we track the workspace folder

    // 1. Extract ALL watchable files from our central rulebook
    const filesToWatch = Object.values(PackageManagerRules)
      .flatMap(rule => rule.watchFiles)
      .map(file => `${workspacePath}/${file}`)
      .join(' ');


    // no files to watch
    if (!filesToWatch) return;

    // 2. Build the inotifywait command
    const command = `inotifywait -m -e close_write ${filesToWatch}`;
    console.log(`[SyncDaemon] Starting watch stream on: ${filesToWatch}`);

    // 3. Open the stream via our exact ExecClient
    const stream = this.execClient.run({ command });

    stream.on('stdout', (data) => {
      const output = data.toString();
      
      // 4. Reverse-lookup which package manager triggered the event

      // TODO: we need to find what we do with these emits
      for (const [managerType, rule] of Object.entries(PackageManagerRules)) {
        if (rule.watchFiles.some(file => output.includes(file))) {
          this.emit('dependency_changed', managerType);
          break;
        }
      }
    });

    stream.on('error', (err) => {
      console.error('[SyncDaemon Error]', err.message);
      this.emit('error', err);
    });

    // add this to the workspaces we are watching
    this.workspaces.push(filesToWatch);
  }

  // we can also stop watching
   public stopWatching(workspacePath: string){

  }

   public onDependencyChanged(cb: (pkgManager: 'apt' | 'npm' | 'pip') => void): void {
    this.on('dependency_changed', cb);
  }

  public onError(cb: (error: Error) => void): void {
    this.on('error', cb);
  }
}