// shared/utils/parser.ts

// RECOMMENDED: the new env file
import { EnvironmentConfig, BuildStep } from '../types/env';

export class ConfigParser {
  
  public static parseAndValidate(rawJson: string): EnvironmentConfig {
    let config: EnvironmentConfig;
    
    try {
      config = JSON.parse(rawJson);
    } catch (err) {
      throw new Error("Invalid JSON format.");
    }

    if (!config || !config.baseImage || typeof config.baseImage !== 'string') {
      throw new Error("Configuration Error: 'baseImage' is required.");
    }

    config.buildSteps = config.buildSteps || [];
    
    this.validateSteps(config.buildSteps);

    return config;
  }

  private static validateSteps(steps: BuildStep[]) {
    const safeNameRegex = /^[a-zA-Z0-9\-_\.@]+$/; // Added @ for npm versions

    for (const step of steps) {
      // 1. Validate Paths
      if (step.targetPath && !step.targetPath.startsWith('/')) {
         throw new Error(`Path Error in step '${step.name}': targetPath must be absolute (e.g., /workspace/app).`);
      }

      // 2. Validate Shell Injection on package arrays
      if (step.packages) {
        for (const pkg of step.packages) {
          if (!safeNameRegex.test(pkg)) {
            throw new Error(`Security Violation: Package '${pkg}' in step '${step.name}' contains invalid characters.`);
          }
        }
      }

      // 3. Ensure shell steps actually have a command
      if (step.type === 'shell' && !step.command) {
         throw new Error(`Validation Error: Step '${step.name}' is type 'shell' but has no command defined.`);
      }
    }
  }
}