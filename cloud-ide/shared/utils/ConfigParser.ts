/*      shared/utils/ConfigParser.ts
*
*   This file defines build rules to parse the JSON and see if its a valid IDE Environment
*   
*
*/
import { IDEEnvironmentConfig, PackageDef, VirtualEnvDef } from '../types/builder';

export class ConfigParser {
  
  public static parseAndValidate(rawJson: string): IDEEnvironmentConfig {
    let config: IDEEnvironmentConfig;
    
    // validate if its a valid JSON file
    try {
      config = JSON.parse(rawJson);
    } catch (err) {
      throw new Error("Invalid JSON format.");
    }

    // Safely initialize missing arrays/objects to prevent null pointer errors
    config.system = config.system || [];
    config.languages = config.languages || {};
    
    for (const lang of Object.values(config.languages)) {
      lang.hybridGlobalLibraries = lang.hybridGlobalLibraries || [];
      lang.virtualEnvironments = lang.virtualEnvironments || [];
    }

    // Run the gauntlet of rules
    this.validateNoShellInjectionRule(config);
    this.validateBaseImageConflictsRule(config);
    this.validateVirtualEnvironmentsRule(config);

    return config;
  }

  // --- DYNAMIC HELPERS ---
  
  /**
   * Recursively extracts every single package defined anywhere in the config.
   * Useful for global security sweeps.
   */
  private static getAllPackages(config: IDEEnvironmentConfig): PackageDef[] {
    const packages: PackageDef[] = [...config.system];
    
    for (const lang of Object.values(config.languages)) {
      packages.push(...lang.hybridGlobalLibraries);
      for (const venv of lang.virtualEnvironments) {
        packages.push(...(venv.libraries || []));
      }
    }
    return packages;
  }

  /**
   * Extracts all virtual environment definitions across all languages.
   */
  private static getAllVirtualEnvs(config: IDEEnvironmentConfig): VirtualEnvDef[] {
    return Object.values(config.languages).flatMap(lang => lang.virtualEnvironments);
  }

  // --- RULE IMPLEMENTATIONS ---

  private static validateNoShellInjectionRule(config: IDEEnvironmentConfig) {
    // Rule: test package names for injection characters like ;, | or &&
    const safeNameRegex = /^[a-zA-Z0-9\-_\.]+$/; 
    const allPackages = this.getAllPackages(config);

    for (const pkg of allPackages) {
      if (!safeNameRegex.test(pkg.name)) {
        throw new Error(`Security Violation: Package name '${pkg.name}' contains invalid characters.`);
      }
    }
  }

  private static validateBaseImageConflictsRule(config: IDEEnvironmentConfig) {
    
    const [baseName, baseTag] = config.baseImage.toLowerCase().split(':');
    
    // 1. System Package Rule: if we have a package in system already installed in our base image, throw an error
    // The aim is we dont reinstall the default image again

    
    // NOTE: to add aliases we simply update this list
    const knownAliases: Record<string, string[]> = {
      'python': ['python', 'python3'],
      'node': ['node', 'nodejs'],
      'golang': ['go', 'golang']
    };

    const forbiddenSystemPackages = knownAliases[baseName] || [baseName];
    // if we have a package in system already installed in our base image, throw an error
    for (const pkg of config.system) {
      if (forbiddenSystemPackages.includes(pkg.name.toLowerCase())) {
        throw new Error(
          `Conflict: The base image '${config.baseImage}' inherently provides '${baseName}'. ` +
          `Remove '${pkg.name}' from your system packages.`
        );
      }
    }

    // 2. The Venv Version Redundancy Rule: if we try to install a version and language in our venv defined in global, throw an error
    for (const [langKey, langSection] of Object.entries(config.languages)) {
      if (langKey.toLowerCase() === baseName) {
        for (const venv of langSection.virtualEnvironments) {
          if (venv.version && baseTag && baseTag.startsWith(venv.version)) {
            throw new Error(
              `Redundancy Error: Workspace '${venv.name}' requests ${langKey} version '${venv.version}'. ` +
              `This is unnecessary because the base image '${config.baseImage}' already provides it.`
            );
          }
        }
      }
    }
  }

  private static validateVirtualEnvironmentsRule(config: IDEEnvironmentConfig) {
    // Rule:Look at the comments below 
    const targetedDirectories = new Set<string>();
    const allVenvs = this.getAllVirtualEnvs(config);

    for (const venv of allVenvs) {
      // 1. Path Validity Rule: check if our path is a valid path
      if (!venv.targetPath || !venv.targetPath.startsWith('/')) {
         throw new Error(`Configuration Error: Workspace '${venv.name}' must have an absolute targetPath (e.g., /workspace/app).`);
      }

      // 2. Directory Conflict Rule: Checks if we are trying to install multiple instances in a single place
      const normalizedPath = venv.targetPath.trim().replace(/\/$/, ""); 
      
      if (targetedDirectories.has(normalizedPath)) {
        throw new Error(`Path Conflict: Multiple workspaces are trying to mount to '${normalizedPath}'.`);
      }
      targetedDirectories.add(normalizedPath);
    }
  }
}