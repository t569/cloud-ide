// shared/utils/dockergen.ts
import { EnvironmentConfig, BuildStep } from '../types/env';

export class DockerGenerator {
  
  public static generate(config: EnvironmentConfig): string {
    let df = `FROM ${config.baseImage}\n\n`;
    
    df += `# --- BASE SYSTEM SETUP ---\n`;
    df += `ENV DEBIAN_FRONTEND=noninteractive\n`;
    df += `ENV TERM=xterm-256color\n\n`;

    const steps = config.buildSteps || [];


    // for each build step, add custom install instructions
    for (const step of steps) {
      df += `\n# --- STEP: ${step.name} ---\n`;

      // 1. Handle Working Directory (Isolation)
      if (step.targetPath) {
        df += `RUN mkdir -p ${step.targetPath}\n`;
        df += `WORKDIR ${step.targetPath}\n`;
      } else {
        // Default to root workspace if no path is specified
        df += `WORKDIR /workspace\n`;
      }

      // 2. Translate the Command
      df += this.translateStep(step);
    }

    df += `\n# --- ENTRYPOINT ---\n`;
    df += `WORKDIR /workspace\n`;
    df += `CMD ["bash"]\n`;

    return df;
  }

  private static translateStep(step: BuildStep): string {
    const pkgs = step.packages?.join(' ') || '';


    // here, we define rules for custom install step types: we can add cargo and friends later
    switch (step.type) {
      case 'shell':
        return `RUN ${step.command}\n`;

      case 'apt':
        return `RUN apt-get update && apt-get install -y --no-install-recommends ${pkgs} && rm -rf /var/lib/apt/lists/*\n`;

      case 'npm':
        if (step.isGlobal) {
          return `RUN npm install -g ${pkgs}\n`;
        } else {
          // Local install requires a package.json to exist or it will just create a node_modules
          return `RUN if [ ! -f package.json ]; then npm init -y; fi && npm install ${pkgs}\n`;
        }

      case 'pip':
        if (step.isGlobal) {
          // Modern Python requires this flag to install globally without a venv
          return `RUN pip3 install --no-cache-dir ${pkgs} --break-system-packages\n`;
        } else {
          // Cloud IDE Magic: Automatically isolate local pip packages in a venv inside the targetPath
          return `RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir ${pkgs}\n`;
        }

      default:
        return '';
    }
  }
}