// pipeline/middleware/MiddlewareEngine.ts
import { PipelineManifest } from '../types/stage';
import { PipelineInjector } from './types';

export class MiddlewareEngine {
  private injectors: PipelineInjector[] = [];

  /**
   * Register a new plugin into the pipeline.
   * Order matters! Injectors are executed in the order they are registered.
   */
  public use(injector: PipelineInjector): this {
    this.injectors.push(injector);
    return this; // Return 'this' to allow method chaining
  }

  /**
   * Run the manifest through all registered plugins.
   */
  public execute(manifest: PipelineManifest): PipelineManifest {
    let currentManifest = { ...manifest };

    for (const injector of this.injectors) {
      try {
        currentManifest = injector.inject(currentManifest);
      } catch (error: any) {
        throw new Error(`Middleware Injection Failed [${injector.name}]: ${error.message}`);
      }
    }

    return currentManifest;
  }
}