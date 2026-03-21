import { BuildStep } from '../types/env';

export interface PackageManagerRule {
  watchFiles: string[]; // Files the SyncDaemon should track
  compileDocker: (step: BuildStep) => string; // The mini-compiler for DockerGenerator
}

// The master dictionary for our language/package environments
export const PackageManagerRules: Record<string, PackageManagerRule> = {
  apt: {
    watchFiles: [], // OS packages don't typically use local lockfiles
    compileDocker: (step) => {
      const pkgs = step.packages?.join(' ') || '';
      return `RUN apt-get update && apt-get install -y ${pkgs}\n`;
    }
  },
  npm: {
    watchFiles: ['package.json', 'package-lock.json'],
    compileDocker: (step) => {
      const pkgs = step.packages?.join(' ') || '';
      if (step.isGlobal) return `RUN npm install -g ${pkgs}\n`;
      return `RUN if [ ! -f package.json ]; then npm init -y; fi && npm install ${pkgs}\n`;
    }
  },
  pip: {
    watchFiles: ['requirements.txt', 'Pipfile'],
    compileDocker: (step) => {
      const pkgs = step.packages?.join(' ') || '';
      if (step.isGlobal) return `RUN pip3 install --no-cache-dir ${pkgs} --break-system-packages\n`;
      return `RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir ${pkgs}\n`;
    }
  },
  shell: {
    watchFiles: [],
    compileDocker: (step) => `RUN ${step.command}\n`
  }
};