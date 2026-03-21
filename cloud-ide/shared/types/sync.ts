// @cloud-ide/shared/types/sync.ts

// this file defines an interface for building syncing daemons for our development environment

// based on our backend sandbox architecture, this syncing logic can change 
export interface IFileWatcher {
  startWatching(workspacePath: string): void;
  stopWatching(): void;
  onDependencyChanged(callback: (pkgManager: 'npm' | 'pip' | 'apt') => void): void;
  onError(callback: (error: Error) => void): void;
}