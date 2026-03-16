// shared/utils/ConfigParser.ts
// This is a parser validator to validate if the IDEEnvironmentConfig type we built follows all the build rules


import { IDEEnvironmentConfig, PackageDef } from '../types/builder';

export class ConfigParser {
  
  /**
   * Parses the raw JSON and runs all validation rules.
   * Throws an Error if the config violates any architectural constraints.
   */
  public static parseAndValidate(rawJson: string): IDEEnvironmentConfig {
    let config: IDEEnvironmentConfig;
    
    // first we check if its valid JSON
    try {
      config = JSON.parse(rawJson);
    } catch (err) {
      throw new Error("Invalid JSON format.");
    }

    
    // then we validate all the build rules
    this.validateNoShellInjection(config);
    this.validateBaseImageConflicts(config);
    this.validateDirectoryStructures(config);
    this.validateLocalPaths(config);

    // and finally we return our IDEEnvironmentConfig value if valid
    return config;
  }

  // --- RULE IMPLEMENTATIONS ---

  private static validateNoShellInjection(config: IDEEnvironmentConfig) {
    // Regex to block dangerous shell operators examples being ;, &&, or |
    const safeNameRegex = /^[a-zA-Z0-9\-_\.]+$/; 

    const checkPackages = (pkgs: PackageDef[] = []) => {
      for (const pkg of pkgs) {
        if (!safeNameRegex.test(pkg.name)) {
          throw new Error(`Security Violation: Package name '${pkg.name}' contains invalid characters.`);
        }
      }
    };


    // check all system packages for this rule
    checkPackages(config.system);

    // NOTE: when we add a new language we have to actually add checkPackages for it
    // now we optionally check for all the languages
    checkPackages(config.languages?.python?.libraries);
    checkPackages(config.languages?.node?.libraries);
    
    
  }

  private static validateBaseImageConflicts(config: IDEEnvironmentConfig) {
    // Rule: You cannot add a section that is the same language/version as the base image.
    const base = config.baseImage.toLowerCase();

    if (base.includes('python') && config.system?.some(p => p.name.includes('python'))) {
      throw new Error("Conflict: Base image is already Python. Do not install Python via system packages.");
    }
    
    if (base.includes('node') && config.system?.some(p => p.name.includes('nodejs'))) {
      throw new Error("Conflict: Base image is already Node. Do not install Node.js via system packages.");
    }
  }

  private static validateDirectoryStructures(config: IDEEnvironmentConfig) {
    // Rule: Directory structures mustn't conflict.
    const targetedDirectories = new Set<string>();

    const checkDirectoryConflicts = (pkgs: PackageDef[] = []) => {
      for (const pkg of pkgs) {
        if (pkg.scope === 'local' && pkg.targetPath) {
          const normalizedPath = pkg.targetPath.trim().replace(/\/$/, ""); // Remove trailing slashes
          
          if (targetedDirectories.has(normalizedPath)) {
            throw new Error(`Path Conflict: Multiple local installations are targeting '${normalizedPath}'.`);
          }
          targetedDirectories.add(normalizedPath);
        }
      }
    };

    checkDirectoryConflicts(config.languages?.python?.libraries);
    checkDirectoryConflicts(config.languages?.node?.libraries);
  }

  private static validateLocalPaths(config: IDEEnvironmentConfig) {
    // Rule: Local installs must specify a path.
    const checkPaths = (pkgs: PackageDef[] = []) => {
      for (const pkg of pkgs) {
        if (pkg.scope === 'local' && !pkg.targetPath) {
          throw new Error(`Configuration Error: Package '${pkg.name}' is set to local but is missing a targetPath.`);
        }
        if (pkg.targetPath && !pkg.targetPath.startsWith('/')) {
           throw new Error(`Configuration Error: targetPath '${pkg.targetPath}' must be an absolute Unix path (e.g., /workspace).`);
        }
      }
    };

    checkPaths(config.languages?.python?.libraries);
    checkPaths(config.languages?.node?.libraries);
  }
}