// pipeline/Validator.ts

/* this file is responsible for validating the user-provided environment configuration,
 * it checks for things like:
 * - ensuring the base image is valid and supported
 */

// shared/utils/Validator.ts
import { EnvironmentConfig, BuildStep, baseAliases } from '../types/env';

export class Validator {
  
  // ==========================================
  // CONFIGURATION & GUARDRAILS
  // ==========================================
  private static readonly MAX_STEPS = 20; 
  private static readonly MAX_TIMEOUT = 3600; 

  /**
   * Rule 2: Reserved Directory Protection
   * Blacklist of critical Linux system directories. We block any targetPath 
   * that attempts to mount or build directly into these sensitive areas.
   */
  private static readonly RESERVED_PATHS = [
    '/bin', '/sbin', '/etc', '/lib', '/lib64', 
    '/usr/bin', '/usr/sbin', '/usr/lib', 
    '/boot', '/dev', '/proc', '/sys', '/root'
  ];

  /**
   * Rule 3: Environment Variable Security
   * Regex to catch common secret-related keys in standard ENV objects.
   */
  private static readonly SENSITIVE_KEY_REGEX = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH|API/i;


  // ==========================================
  // PUBLIC ENTRY POINT
  // ==========================================
  public static parseAndValidate(rawJson: string): EnvironmentConfig {
    let config: EnvironmentConfig;
    
    try {
      config = JSON.parse(rawJson);
    } catch (err) {
      throw new Error("Validation Error: Invalid JSON format.");
    }

    if (!config || !config.baseImage || typeof config.baseImage !== 'string') {
      throw new Error("Configuration Error: 'baseImage' is required and must be a string.");
    }

    // Safely initialize arrays/objects to prevent null pointer exceptions
    config.buildSteps = config.buildSteps || [];
    config.env = config.env || {};
    
    // Enforce limits to prevent runaway builds
    if (config.buildSteps.length > this.MAX_STEPS) {
      throw new Error(`Limit Exceeded: Maximum of ${this.MAX_STEPS} build steps allowed to prevent layer bloat.`);
    }

    if (config.timeout && config.timeout > this.MAX_TIMEOUT) {
      throw new Error(`Limit Exceeded: Timeout cannot exceed ${this.MAX_TIMEOUT} seconds.`);
    }

    // Run the validation gauntlet
    this.validateEnvSecurity(config.env);
    this.validateSteps(config);

    return config;
  }


  // ==========================================
  // CORE VALIDATION RULES
  // ==========================================

  /**
   * Validates that no sensitive secrets are leaked via standard environment variables.
   */
  private static validateEnvSecurity(env: Record<string, string>): void {
    for (const key of Object.keys(env)) {
      if (this.SENSITIVE_KEY_REGEX.test(key)) {
        throw new Error(
          `Security Alert: Environment variable '${key}' appears to contain sensitive data. ` +
          `Do not use plain text ENV variables for secrets. Use a dedicated BuildKit secret mount pipeline instead.`
        );
      }
    }
  }

  /**
   * The master step validator. Handles shell injection, path conflicts, 
   * dependency resolution (execution order), and redundancy against env.ts.
   */
  private static validateSteps(config: EnvironmentConfig): void {
    // Allows @ (npm), == (pip), ~ (versioning), and standard chars
    const safeNameRegex = /^[a-zA-Z0-9\-_\.@~=]+$/; 
    const targetPaths = new Set<string>();
    
    const [baseName, baseTag] = config.baseImage.toLowerCase().split(':');
    
    // Rule 1: Execution Order Tracking (Dependency Graphing)
    // Seed capabilities with what the base image provides inherently from baseAliases
    const availableCapabilities = new Set<string>(baseAliases[baseName] || [baseName]);

    for (const [index, step] of config.buildSteps.entries()) {
      
      // ----------------------------------------------------
      // PATH VALIDATION (Consistency, Conflict & Blacklist)
      // ----------------------------------------------------
      if (step.targetPath) {
        if (!step.targetPath.startsWith('/')) {
          throw new Error(`Configuration Error: Step '${step.name}' must use an absolute targetPath.`);
        }
        
        const normalizedPath = step.targetPath.replace(/\/$/, "");

        // Check against Reserved Directory Blacklist
        if (this.RESERVED_PATHS.some(reserved => normalizedPath === reserved || normalizedPath.startsWith(`${reserved}/`))) {
           throw new Error(`Security Alert: Step '${step.name}' attempts to mount to a reserved system path ('${normalizedPath}').`);
        }

        if (targetPaths.has(normalizedPath)) {
          throw new Error(`Path Conflict: '${normalizedPath}' is assigned to multiple distinct steps.`);
        }
        targetPaths.add(normalizedPath);
      }

      // ----------------------------------------------------
      // EXECUTION ORDER VALIDATION (Chronological Graphing)
      // ----------------------------------------------------
      // If the step relies on a specific package manager, ensure the language was installed prior.
      if (step.type === 'npm' && !availableCapabilities.has('npm') && !availableCapabilities.has('node')) {
        throw new Error(`Execution Order Error: Step '${step.name}' at index ${index} uses 'npm', but Node.js has not been installed yet. Ensure an 'apt' step installs it first.`);
      }
      if (step.type === 'pip' && !availableCapabilities.has('pip') && !availableCapabilities.has('python')) {
        throw new Error(`Execution Order Error: Step '${step.name}' at index ${index} uses 'pip', but Python has not been installed yet.`);
      }
      if (step.type === 'cargo' && !availableCapabilities.has('rust') && !availableCapabilities.has('cargo')) {
         throw new Error(`Execution Order Error: Step '${step.name}' at index ${index} uses 'cargo', but Rust has not been installed yet.`);
      }
      if (step.type === 'go' && !availableCapabilities.has('golang') && !availableCapabilities.has('go')) {
         throw new Error(`Execution Order Error: Step '${step.name}' at index ${index} uses 'go', but Golang has not been installed yet.`);
      }

      // ----------------------------------------------------
      // PACKAGE VALIDATION (Shell Injection & Redundancy)
      // ----------------------------------------------------
      if (step.packages) {
        for (const pkg of step.packages) {
          
          // Security: Regex check for injection
          if (!safeNameRegex.test(pkg)) {
            throw new Error(`Security Violation: Package '${pkg}' in step '${step.name}' contains invalid characters.`);
          }

          const rawPkgName = pkg.toLowerCase().split(/[=@]/)[0]; // Strip version (@ or ==) for checking

          // Redundancy Check: Don't install what the base image inherently provides globally
          const forbidden = baseAliases[baseName] || [baseName];
          if (forbidden.includes(rawPkgName) && step.isGlobal !== false) {
            if (!step.version || (baseTag && baseTag.includes(step.version))) {
              throw new Error(`Redundancy Error: '${config.baseImage}' already provides ${pkg}${step.version ? ' ' + step.version : ''}.`);
            }
          }

          // Register new capabilities for future steps 
          if (step.type === 'apt') {
             if (rawPkgName.includes('node')) availableCapabilities.add('npm');
             if (rawPkgName.includes('python')) availableCapabilities.add('pip');
             if (rawPkgName.includes('rust') || rawPkgName.includes('cargo')) availableCapabilities.add('cargo');
             if (rawPkgName.includes('golang') || rawPkgName === 'go') availableCapabilities.add('go');
          }
        }
      }

      // ----------------------------------------------------
      // COMMAND VALIDATION (For Shell Steps)
      // ----------------------------------------------------
      if (step.type === 'shell' && (!step.command || step.command.trim() === '')) {
         throw new Error(`Validation Error: Step '${step.name}' is type 'shell' but has no command defined.`);
      }
    }
  }
}