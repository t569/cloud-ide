// 
/*
*       shared/utils/DockerGenerator.ts
*   This generates the dockerfile after we validate that the environment works with the parsing rules
* 
*/
import { IDEEnvironmentConfig, PackageDef, LanguageSection, VirtualEnvDef } from '../types/builder';

export class DockerGenerator {
  
  /**
   * Translates a validated IDEEnvironmentConfig into a raw Dockerfile string.
   * This breaks our JSON into the respective commands
   */
  public static wegenerate(config: IDEEnvironmentConfig): string {
    
    let df = `FROM ${config.baseImage}\n\n`;
    
    // 1. Core OS Configuration
    df += `# --- SYSTEM ENVIRONMENT ---\n`;
    df += `ENV DEBIAN_FRONTEND=noninteractive\n`;   // this prevents the build from hanging if a system package prompts the user for a timezone or keyboard layout.
    df += `ENV TERM=xterm-256color\n\n`; // Ensures colors work immediately in the terminal

    // THE FIX: Extract safely before passing to the helpers
    const safeSystemPackages = config.system || [];
    const safeLanguagesPackages = config.languages || {};

    // 2. System Packages
    df += this.buildSystemPackages(safeSystemPackages);

    // 3. Global Language Tools (The Hybrids)
    df += this.buildHybridGlobals(safeLanguagesPackages);

    // 4. Localized Workspaces (Virtual Environments)
    df += this.buildVirtualEnvironments(safeLanguagesPackages);

    // 5. Default Entrypoint
    df += `\n# --- ENTRYPOINT ---\n`;
    df += `WORKDIR /workspace\n`;
    df += `CMD ["bash"]\n`;

    return df;
  }

  // Helper functions

  // Write rule for system packages 
  private static buildSystemPackages(systemPkgs: PackageDef[]): string {
    if (!systemPkgs || systemPkgs.length === 0) return '';

    // we map our array into a single string so we dont run one command a large number of times
    // we parse all the data needed once
    const pkgNames = systemPkgs.map(p => p.name).join(' ');
    
    let block = `# --- OS SYSTEM PACKAGES ---\n`;
    block += `RUN apt-get update && apt-get install -y --no-install-recommends ${pkgNames} \\\n`;
    block += `    && rm -rf /var/lib/apt/lists/*\n\n`; // Cleans up the apt cache to shrink the image size
    
    return block;
  }


  // write rule for global language tools
  private static buildHybridGlobals(languages: Record<string, LanguageSection>): string {
    let block = `# --- GLOBAL LANGUAGE TOOLS ---\n`;
    let added = false;

    // loop through every language section and find global libraries
    // if none, we skip to the next language

    for (const [langKey, langSection] of Object.entries(languages)) {
      const globals = langSection.hybridGlobalLibraries;
      if (!globals || globals.length === 0) continue;

      added = true;
      const pkgStrings = globals.map(p => p.version ? `${p.name}@${p.version}` : p.name).join(' ');

      // Route the installation based on the language
      if (langKey.toLowerCase() === 'node') {
        block += `RUN npm install -g ${pkgStrings}\n`;
      } 
      else if (langKey.toLowerCase() === 'python') {
        // Modern Python requires --break-system-packages if installing globally on a base OS,
        // or we use pipx for safe global CLI tool installation.
        const pyPkgs = globals.map(p => p.version ? `${p.name}==${p.version}` : p.name).join(' ');
        block += `RUN pip3 install --no-cache-dir ${pyPkgs} --break-system-packages\n`;
      }
      //NOTE:  You can easily add 'go', 'ruby', etc. here later
    }

    return added ? block + '\n' : '';
  }


  private static buildVirtualEnvironments(languages: Record<string, LanguageSection>): string {
    let block = `# --- ISOLATED WORKSPACES (VIRTUAL ENVIRONMENTS) ---\n`;
    let added = false;
    // loop through every language section and find virtual environments 
    // if none, we skip to the next language

    for (const [langKey, langSection] of Object.entries(languages)) {
      const venvs = langSection.virtualEnvironments;
      if (!venvs || venvs.length === 0) continue;
    
      // set up the  WORKDIR at the specified targetPath by creating a folder
      for (const venv of venvs) {
        added = true;
        block += `\n# Setting up workspace: ${venv.name} at ${venv.targetPath}\n`;
        block += `RUN mkdir -p ${venv.targetPath}\n`;
        block += `WORKDIR ${venv.targetPath}\n`;

        // Create the package list
        const libs = venv.libraries || [];

        // NOTE: you can set up other configs for other languages to setup their virtual environment installs
        
        if (langKey.toLowerCase() === 'node') {
          const pkgStrings = libs.map(p => p.version ? `${p.name}@${p.version}` : p.name).join(' ');
          
          block += `RUN npm init -y\n`;
          if (pkgStrings) {
            // If the user requested a specific Node version for this venv, we'd use nvm or n here.
            // For brevity, assuming native node usage:
            block += `RUN npm install ${pkgStrings}\n`;
          }
        } 
        else if (langKey.toLowerCase() === 'python') {
          const pyPkgs = libs.map(p => p.version ? `${p.name}==${p.version}` : p.name).join(' ');
          
          // Determine the Python binary to use. If they asked for a specific version 
          // (e.g., 3.8 on a 3.10 base), we assume apt-get can fetch it.
          const pyBinary = venv.version ? `python${venv.version}` : `python3`;
          
          if (venv.version) {
             block += `RUN apt-get update && apt-get install -y ${pyBinary} ${pyBinary}-venv\n`;
          }

          // Create the true isolated venv inside the target path
          block += `RUN ${pyBinary} -m venv .venv\n`;
          
          if (pyPkgs) {
            // We MUST use the isolated pip binary inside the .venv folder, NOT the global pip
            block += `RUN .venv/bin/pip install --no-cache-dir ${pyPkgs}\n`;
          }
        }
      }
    }


    // add a new line lmao
    return added ? block + '\n' : '';
  }

}