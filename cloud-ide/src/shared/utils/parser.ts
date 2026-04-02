// shared/utils/parser.ts

// RECOMMENDED: the new env file
import { EnvironmentConfig, BuildStep } from '../types/env';

// registry for aliases 
import { baseAliases } from '../types/env';

export class ConfigParser {
  
  // BASIC BUILD CONFIG PARAMS
  private static readonly MAX_STEPS = 20; // prevent infinite layer bloat
  private static readonly MAX_TIMEOUT = 3600; // 1 hour max time to build

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

    // initialize arrays to prevent interation errors
    config.buildSteps = config.buildSteps || [];
    config.env = config.env || {};
    
    // make sure we dont pass the max time or max steps for a build
    if (config.buildSteps.length > this.MAX_STEPS) {
      throw new Error(`Limit Exceeded: Maximum of ${this.MAX_STEPS} build steps allowed.`);
    }

    if (config.timeout && config.timeout > this.MAX_TIMEOUT) {
      throw new Error(`Limit Exceeded: Timeout cannot exceed ${this.MAX_TIMEOUT} seconds.`);
    }


    this.validateSteps(config);

    return config;
  }

  private static validateSteps(config: EnvironmentConfig) {

    const safeNameRegex = /^[a-zA-Z0-9\-_\.@]+$/; // Added @ for npm versions
    const targetPaths = new Set<string>(); // stores all our unique target paths

    // Extract base image name for conflict checking (we arent installing a package already installed by base image)
    // Turns python:3.10=-slim to name:"python", tag:"3.10-slim"
    const [baseName, baseTag] = config.baseImage.toLowerCase().split(':');
    

    for (const step of config.buildSteps) {

      // 1. Path consistency and conflit rule
      if (step.targetPath){
        const normalized = step.targetPath.replace(/\/$/, "");
        if (targetPaths.has(normalized)) {
          throw new Error(`Path Conflict: '${normalized}' is assigned to multiple steps.`);
        }   
      }
      // 2. Validate Shell Injection on package arrays
      if (step.packages) {
        for (const pkg of step.packages) {
          if (!safeNameRegex.test(pkg)) {
            throw new Error(`Security Violation: Package '${pkg}' in step '${step.name}' contains invalid characters.`);
          }

          // 3. Redundancy rule: Dont reinstall what the base image already provides

          const forbidden = baseAliases[baseName] || [baseName];
          const isCoreLanguage = forbidden.includes(pkg.toLowerCase());

          if(isCoreLanguage && step.isGlobal){
            // Check if the version also matches (preventing redundant 3.10 on a 3.10 image)
            if (!step.version || (baseTag && baseTag.includes(step.version))) {
              throw new Error(
                `Redundancy: '${config.baseImage}' already provides ${pkg}${step.version ? ' ' + step.version : ''}.`
              );
            }
          }
        }
      }

      // 4. Ensure shell steps actually have a command
      if (step.type === 'shell' && (!step.command || step.command.trim() === '')) {
         throw new Error(`Validation Error: Step '${step.name}' is type 'shell' but has no command defined.`);
      }
    }
  }
}