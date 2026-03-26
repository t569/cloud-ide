// shared/utils/dockergen.ts
import { EnvironmentConfig, BuildStep} from '../types/env';
import { PackageManagerRules } from './packagemanager_rules';
import { StepHasher } from './hasher';
import { injectCacheBuster, optimizeLayers } from './optimise';
import { wrapWithGitHubSecrets } from './secrets';


// this is used to estimate the size of our build
export interface BuildReport {
  dockerfile: string;
  estimatedSizeMb: number;
  cacheStatus: Record<string, 'HIT' | 'MISS'>;
}

// use this command to trigger docker builds
// # In your terminal or exec service:
// DOCKER_BUILDKIT=1 docker build --secret id=gh_token,src=TOKEN_FILE -t my-image .


// forceNoCache: for when our package repository(e.g. apt) has updated but our package list hasnt

// NOTE: to use ghToken and secrets, we need buildkit with docker which only works for docker 18.09+
// export class DockerGenerator {
//   public static generate(config: EnvironmentConfig, options:{forceNoCache?:boolean, dryRun?: boolean, useGhToken?:boolean, optimize?:boolean}={}): BuildReport {

//     // -- STAGE 1: BUILDER (LETS BUILD OUR IMAGE):  WE USE ROOT PRIVILEDGES FOR THIS
//     let df = `# -- STAGE 1: BUILDER --\n`;
//     df += `# --- BASE SYSTEM SETUP ---\n`;

//     // Add a platform flag
//     const platform = config.platform ? `--platform=${config.platform} ` : '';
//     df = `FROM ${platform}${config.baseImage} AS builder \n\n`;

//     // Global "No-Cache" trick: Injecting a dynamic timestamp
//     // invalidates every layer below it (layers that dont have our updated package lists)
//     df += injectCacheBuster(options.forceNoCache || false);

//     // We start the image size calculation here
//     let sizeEstimate = 50;

//     // the caches of our individual build steps, so we dont have to run them again
//     let cacheStatus: Record<string, 'HIT' | 'MISS'> = {}


//     // proper terminal colors
//     df += `ENV TERM=xterm-256color\n`;
//     // answer all the useless questions prompted when we install something new with apt-get
//     df += `ENV DEBIAN_FRONTEND=noninteractive\n`;
//     df += `WORKDIR /workspace\n\n`;

//     let currentPath = '/workspace';
//     let steps = config.buildSteps || [];

//     // Run Optimzations
//     steps = options.optimize? optimizeLayers(config.buildSteps) : steps;

//     // EACH BUILD STEP
//     for(const step of steps){
//        // --- CLEANUP RULE 1: Skip Empty Steps ---
//       if (!step.packages?.length && !step.command) continue;

//       df += `\n# --- STEP: ${step.name} ---\n`;

//       // 1. Get the hash of each step for caching
//       const stepHash = StepHasher.hash(step);

//       // LOGIC: If this was a real DB, we'd check if this hash exists
//       // For now, we flag it for the UI
//       // TODO: we can add a database later
//       cacheStatus[step.name] = 'MISS';

//       df += `\n# Hash: ${stepHash}\n`;

//       // 2. Switch working install directory if the install is in a different directory
//       const target = step.targetPath || '/workspace';
//       if(target !== currentPath){  
//         df += `WORKDIR ${target}\n`;  // WORKDIR automatically creates the path (no mkdir needed)
//         currentPath = target;
//       }

//       // 3. Wrap our commands in a github secret if it requires it

//       // 3.1. genenate the raw command from rules
//       const rawCmd = this.translateStep(step);

//       // 3.2. wrap with secret logic if it's a git-related shell command or private npm
//       const finalCmd = (step.type === 'shell' || step.type === 'npm') 
//       ? wrapWithGitHubSecrets(rawCmd, options.useGhToken || false)
//         : `RUN ${rawCmd}\n`;

//       // Dry Run Estimation (Rough heuristic)
//       // TODO: make this better
//       if (step.packages) {
//         // TODO: change later for better size estimates
//         sizeEstimate += step.packages.length * 15; // Assume ~15MB per package
//       }
//     }
    
//     // -- STAGE 2: FINAL RUNTIME:  WE CHOOSE BETWEEN ROOT AND USER
//     df += this.runtimeStep(config);

//     return {
//       dockerfile: df,
//       estimatedSizeMb: sizeEstimate,  // TODO: make this calculation more robust
//       cacheStatus: cacheStatus
//     };
//   }

//   private static translateStep(step: BuildStep): string {
//     const rule = PackageManagerRules[step.type];
//     if(!rule) throw new Error(`Compilation Error: Unsupported step type ${step.type}`);
//     return rule.compileDocker(step);
//   }

//   // this sets up our user configurations, permissions and entry points
//   private static runtimeStep(config: EnvironmentConfig): string {
//     let df = '';
//     df += `\n\n# --- STAGE 2: FINAL ---\nFROM ${config.baseImage}\n`;
//     df += `# --- BOOT IN AS EITHER ROOT OR USER ---`;


//     // Always create the user just in case, but only USE them if needed

//     // 1. Install Sudo and create devuser
//     df += `RUN apt-get update && apt-get install -y sudo && rm -rf /var/lib/apt/lists/*\n`;
//     df += `RUN groupadd -r devuser && useradd -r -g devuser -m -d /home/devuser devuser\n`;
    
//     // 2. Allow devuser to use sudo WITHOUT a password (standard for dev containers)
//      df += `RUN echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers\n`;
    

//     // 3. Copy the workspace
//     df += `COPY --from=builder /workspace /workspace\n`;

//     // 4. Critical for GitStrategy: Ensure /workspace is writable by devuser
//     df += `RUN mkdir -p /workspace && chown -R devuser:devuser /workspace\n`;

  
//     df += `\n# --- ENTRYPOINT ---\n`;

//     // THE TOOGLE LOGIC
//     if(config.bootUpAsRoot){
//       df += `# Booting as Root per config\n`;
//       df += `USER root\n`;
//     }
//     else {
//       // If not root, ensure the user owns the workspace and switch
//       df += `\n# Booting as devuser, ensuring they own /workspace\n`;
//       df += `USER devuser\n`;
    
//     }

//     // HEALTHCHECK: Checks if the workspace is ready and sudo is functional
//     df += `\n# --- HEALTHCHECK ---\n`;
//     df += `HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \\\n`;
//     df += `  CMD sudo -u devuser ls /workspace || exit 1\n`;
    
//     // ENTRYPOINT
//     df += `\n # --- ENTRYPOINT ---\n`
//     df += `WORKDIR /workspace\n`;
//     df += `CMD ["bash"]\n`;

//     return df;
//   }
// }

// The DIR we search to get size estimates
const BASE_IMAGE_SIZES: Record<string, number> = {
  // TODO: we will implement this later
}

// TODO: we will implement this later
const PKG_SIZE_WEIGHTS: Record<string, number> = {
  'apt': 25,
  'npm': 10,
  'pip': 15,
};

// Note: this new version uses dockerbuildkit
// we might need to refactor to take the different versions into consideration
export class DockerGenerator {


  // the generate function
  public static generate(config: EnvironmentConfig,
                          options: {
                            forceNoCache?: boolean,
                            dryRun?: boolean,
                            useGhToken?: boolean,
                            optimize?: boolean
                          } = {}
  ) : BuildReport {


    // Enable BuildKit syntax for advanced caching
    let df = `# syntax=docker/dockerfile:1.4\n`;
    df += `# --- ENVIRONMENT: ${config.name} ---\n`;

    // If we have a platform flag
    const platform = config.platform ? `--platform=${config.platform} `:'';
    df += `FROM ${platform}${config.baseImage}\n\n`;

    df += injectCacheBuster(options.forceNoCache || false);

    // Initialise size estimation based on known image sizes
    let sizeEstimate = BASE_IMAGE_SIZES[config.baseImage] || 150;
    let cacheStatus: Record<string, 'HIT' | 'MISS'> = {};


    // Standard Dev User Step(Run early to cache this layer)
    df += `ENV TERM=xterm-256color DEBIAN_FRONTEND=noninteractive\n`;
    
    // 1. DYNAMIC SYSTEM PREPARATION
    df += this.getSystemSetup(config.baseImage);


    df += `WORKDIR /workspace\n`;
    let currentPath = '/workspace';

    // Optimise the steps if optimize is turned on
    let steps = config.buildSteps || [];
    steps = options.optimize ? optimizeLayers(steps) : steps;

    for(const step of steps){
      if(!step.packages?.length && !step.command) continue;


      // Sort the packages alphabetically so the hasher can generate the right hashes
      if(step.packages) step.packages.sort();

      const stepHash = StepHasher.hash(step);
      cacheStatus[step.name] = 'MISS';

      // NOTE: this is where we inject any other dependencies that various sandbox tools would require
      df += `\n# --- STEP: ${step.name} | Hash: ${stepHash} ---\n`;

      // Switch working path for installs if we arent already in said working path
      const target = step.targetPath || '/workspace';
      if(target != currentPath){
        df += `WORKDIR ${target}\n`;
        currentPath = target;
      }

      const rawCmd = this.translateStepWithBuildKit(step);

      // we wrap the code with the requires secrets
      // TODO: make this more robust
      const finalCmd = (step.type === 'shell' || step.type === 'npm')
        ? wrapWithGitHubSecrets(rawCmd, options.useGhToken || false)
        : `RUN ${rawCmd}\n`;

      df += finalCmd;


      // Heuristic size calculation
      if(step.packages) {
        const weight = PKG_SIZE_WEIGHTS[step.type] || 15;
        sizeEstimate += step.packages.length * weight;
      }
    }

    df += `\n# --- PERMISSIONS & RUNTIME ---\n`;
    df += `RUN mkdir -p /workspace && chown -R devuser:devuser /workspace\n`;

    if (config.bootUpAsRoot) {
      df += `USER root\n`;
    } else {
      df += `USER devuser\n`;
    }

    // Healthcheck & Entrypoint
    df += `HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \\\n`;
    df += `  CMD sudo -u devuser ls /workspace || exit 1\n`;
    
    df += `CMD ["bash"]\n`;
    
    return {
      dockerfile: df,
      estimatedSizeMb: Math.round(sizeEstimate),
      cacheStatus: cacheStatus
    };
  }

  // Detects the OS family based on the image name and provides the right setup tools
  private static getSystemSetup(baseImage: string): string {
    const isAlpine = baseImage.includes('alpine');


    // we now mount into the proper OS, with the proper bash shell 
    if (isAlpine) {
      return `
    # --- SYSTEM PREPARATION (ALPINE) ---
    RUN apk update && apk add --no-cache sudo ca-certificates curl bash \\
    && addgroup -S devuser && adduser -S -G devuser -s /bin/bash devuser \\
    && echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers\n\n`;
    } else {
      return `
    # --- SYSTEM PREPARATION (DEBIAN/UBUNTU) ---
    RUN rm -f /etc/apt/apt.conf.d/docker-clean; echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache
    RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
    apt-get update && apt-get install -y --no-install-recommends sudo ca-certificates curl \\
    && groupadd -r devuser && useradd -r -g devuser -m -s /bin/bash -d /home/devuser devuser \\
    && echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers\n\n`;
    }
  }
  // TODO: integrate this into package manager rules
  // Abstracted to a new method to inject BuildKit caching natively
  private static translateStepWithBuildKit(step: BuildStep): string {
    const pkgs = step.packages?.join(' ') || '';
    
    switch (step.type) {
      case 'apt':
        // BuildKit Cache + Auto Cleanup in the same layer
        return `--mount=type=cache,target=/var/cache/apt,sharing=locked \\\n` +
               `    --mount=type=cache,target=/var/lib/apt,sharing=locked \\\n` +
               `    apt-get update && apt-get install -y --no-install-recommends ${pkgs}`;
      case 'npm':
        const globalFlag = step.isGlobal ? '-g' : '';
        return `--mount=type=cache,target=/root/.npm,sharing=locked \\\n` +
               `    npm install ${globalFlag} ${pkgs}`;
      case 'pip':
        return `--mount=type=cache,target=/root/.cache/pip,sharing=locked \\\n` +
               `    pip install --no-cache-dir ${pkgs}`;
      case 'shell':
        return `${step.command}`;
      default:
        throw new Error(`Unsupported step type: ${step.type}`);
    }
  }


}