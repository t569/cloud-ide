// shared/utils/dockergen.ts
import { EnvironmentConfig, BuildStep } from '../types/env';
import { PackageManagerRules } from './packagemanager_rules';

export class DockerGenerator {
  
  public static generate(config: EnvironmentConfig): string {

    // -- STAGE 1: BUILDER (LETS BUILD OUR IMAGE):  WE USE ROOT PRIVILEDGES FOR THIS
    let df = `# -- STAGE 1: BUILDER --`;
    df += `# --- BASE SYSTEM SETUP ---\n`;

    // add a platform flag
    const platform = config.platform ? `--platform=${config.platform}` : '';
    df = `FROM ${platform}${config.baseImage} AS builder \n\n`;

    df += `ENV TERM=xterm-256color\n`;
    // answer all the useless questions prompted when we install something new with apt-get
    df += `ENV DEBIAN_FRONTEND=noninteractive\n`;

    df += `WORKDIR /workspace\n\n`;

    let currentPath = '/workspace';
    const steps = config.buildSteps || [];

    for(const step of steps){
      df += `\n# --- STEP: ${step.name} ---\n`;

      // switch working install directory if the install is in a different directory
      const target = step.targetPath || '/workspace';
      if(target !== currentPath){
      
        // WORKDIR automatically creates the path (no mkdir needed)
        df += `WORKDIR ${target}\n`;
        currentPath = target;
      }

      df += this.translateStep(step);
    }
    
    // -- STAGE 2: FINAL RUNTIME:  WE CHOOSE BETWEEN ROOT AND USER
    df += `\n\n# --- STAGE 2: FINAL ---\nFROM ${config.baseImage}\n`;
    // make color work in the terminal
    df += `# --- BOOT IN AS EITHER ROOT OR USER ---`;


    // Always create the user just in case, but only USE them if needed

    // 1. Install Sudo and create devuser
    df += `RUN apt-get update && apt-get install -y sudo && rm -rf /var/lib/apt/lists/*\n`;
    df += `RUN groupadd -r devuser && useradd -r -g devuser -m -d /home/devuser devuser\n`;
    
    // 2. Allow devuser to use sudo WITHOUT a password (standard for dev containers)
     df += `RUN echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers\n`;
    

    // 3. Copy the workspace
    df += `COPY --from=builder /workspace /workspace\n`;

    // 4. Critical for GitStrategy: Ensure /workspace is writable by devuser
    df += `RUN mkdir -p /workspace && chown -R devuser:devuser /workspace\n`;

  
    df += `\n# --- ENTRYPOINT ---\n`;

    // THE TOOGLE LOGIC
    if(config.bootUpAsRoot){
      df += `# Booting as Root per config\n`;
      df += `USER root\n`;
    }
    else {
      // If not root, ensure the user owns the workspace and switch
      df += `\n# Booting as devuser, ensuring they own /workspace\n`;
      df += `USER devuser\n`;
    
    }

    // HEALTHCHECK: Checks if the workspace is ready and sudo is functional
    df += `\n# --- HEALTHCHECK ---\n`;
    df += `HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \\\n`;
    df += `  CMD sudo -u devuser ls /workspace || exit 1\n`;
    
    // ENTRYPOINT
    df += `\n # --- ENTRYPOINT ---\n`
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