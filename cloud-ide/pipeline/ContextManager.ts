// pipeline/ContextManager.ts

/* this file is used to hold the environment context for our pipeline, 
 * this includes things like the current working directory, the current user, 
 * and any environment variables that we want to pass to our commands.
 * This allows us to maintain state across different steps in our pipeline
 * and also allows us to isolate certain steps in specific directories if needed 
 * (e.g. for language-specific package managers that rely on local config files).
 */

export class PipelineContext {
  private currentPath: string = '/';
  private currentUser: string = 'root';
  private envVars: Record<string, string> = {};

  constructor(initialEnv?: Record<string, string>, bootUpAsRoot: boolean = true) {
    if (initialEnv) {
      this.envVars = { ...initialEnv };
    }
    this.currentUser = bootUpAsRoot ? 'root' : 'sandbox-user';
  }

  public setPath(newPath: string): void {
    if (!newPath.startsWith('/')) {
      throw new Error(`Context Error: Path must be absolute. Received: ${newPath}`);
    }
    this.currentPath = newPath;
  }

  public getPath(): string { return this.currentPath; }
  public getUser(): string { return this.currentUser; }
  public getEnv(): Record<string, string> { return this.envVars; }
}