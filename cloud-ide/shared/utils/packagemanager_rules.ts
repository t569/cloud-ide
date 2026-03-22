import { BuildStep } from '../types/env';

export interface PackageManagerRule {
  watchFiles: string[]; // Files the SyncDaemon should track
  compileDocker: (step: BuildStep) => string; // The mini-compiler for DockerGenerator
  installCommand: (packages: string[], isGlobal?:boolean) => string;  // this is to be run while the container is still active
}

// The master dictionary for our language/package environments

// we can add cargo, and various other package rules
// also remember to add it to InstallStepType

export const PackageManagerRules: Record<string, PackageManagerRule> = {
  // the install commands are run irrespective of if the container is live or not
  // we build compile docker based on these commands

  apt: {
    // install command for apt
    installCommand: (pkgs) => `apt-get update && apt-get install -y ${pkgs.join(' ')}
    && rm -rf /var/lib/apt/lists*`,
    watchFiles: [], // OS packages don't typically use local lockfiles
    compileDocker(step){
      const pkgs = step.packages || []; // either we have packages or we dont
      return pkgs.length? `RUN ${this.installCommand(pkgs)}\n` : '';
    }
  },

  npm: {
    installCommand(pkgs, isGlobal) {
      const pkgString = pkgs.join(' ');
      return isGlobal? `npm install -g ${pkgString}` : 
      `if [ ! -f package.json ]; then npm init -y; fi && npm install ${pkgString}`;
    },
    watchFiles: ['package.json', 'package-lock.json'],
    compileDocker(step){
      const pkgs = step.packages || [];
      return pkgs.length? `RUN ${this.installCommand(pkgs, step.isGlobal)}\n` : '';
    }
  },

  pip: {
    installCommand(pkgs, isGlobal){
      const pkgString = pkgs.join(' ');
      return isGlobal? `pip3 install --no-cache-dir ${pkgString} --break-system-packages`:
      `python3 -m venv .venv && .venv/bin/pip install --no-cache-dir ${pkgString}`;
    },
    watchFiles: ['requirements.txt', 'Pipfile'],
    compileDocker(step) {
      const pkgs = step.packages || [];
      return pkgs.length? `RUN ${this.installCommand(pkgs, step.isGlobal)}\n` : '';
    }
  },
  shell: {
    // for shell installs, we dont have a predefined install command
    installCommand: () => '',
    watchFiles: [],
    compileDocker: (step) => `RUN ${step.command}\n`
  }
};