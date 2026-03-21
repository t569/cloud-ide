// shared/utils/dockergen.ts
import { EnvironmentConfig, BuildStep } from '../types/env';
import { PackageManagerRules } from './packagemanager_rules';

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
    const rule = PackageManagerRules[step.type];
    if(!rule) throw new Error(`Compilation Error: Unsupported step type ${step.type}`);
    return rule.compileDocker(step);
  }
}