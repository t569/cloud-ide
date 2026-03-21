// backend/src/services/synchronization/syncdaemon.ts

// this synchronises our development environment based on new installation commands

import { IFileWatcher } from '@cloud-ide/shared';
import { OpenSandboxExecClient } from '../sandbox/drivers/opensandbox';

export class OpenSandboxSyncDaemon implements IFileWatcher {
  private execClient: OpenSandboxExecClient;
  private callbacks: {
    onChange?: (pkgManager: 'npm' | 'pip' | 'apt') => void;
    onError?: (err: Error) => void;
  } = {};

  constructor(ipAddress: string, execdPort: number) {
    this.execClient = new OpenSandboxExecClient(ipAddress, execdPort);
  }

  public startWatching(workspacePath: string = '/workspace') {
    const command = `inotifywait -m -e close_write ${workspacePath}/package.json ${workspacePath}/requirements.txt`;
    const stream = this.execClient.run({ command });

    stream.on('stdout', (data) => {
      const output = data.toString();
      if (output.includes('package.json') && this.callbacks.onChange) {
         this.callbacks.onChange('npm');
      } else if (output.includes('requirements.txt') && this.callbacks.onChange) {
         this.callbacks.onChange('pip');
      }
    });

    stream.on('error', (err) => {
      if (this.callbacks.onError) this.callbacks.onError(err);
    });
  }

  public stopWatching() {
    // Logic to kill the inotifywait process via execd
  }

  public onDependencyChanged(cb: (pkgManager: 'npm' | 'pip' | 'apt') => void) {
    this.callbacks.onChange = cb;
  }

  public onError(cb: (error: Error) => void) {
    this.callbacks.onError = cb;
  }
}