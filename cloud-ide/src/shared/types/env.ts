// shared/types/env.ts
// RECOMMENDED, we will use this from now on



// we can then add any type
export const INSTALL_STEPS = [
  'apt', 'npm', 'pip',
  'cargo', 'go', 'ruby',
  'maven', 'gradle', 'zig', 'shell'
] as const; 


export type InstallStepType = typeof INSTALL_STEPS[number];


// each build step should define an isolated workflow for a particular path
export interface BuildStep {
  name: string;           // e.g., "Install System Dependencies"
  type: InstallStepType;  
  
  // Data for the step
  packages?: string[];    // Used if type is 'apt', 'npm', or 'pip'
  // wwe pass in the type to the name e.g. numpy==1.0.0 for pip, or express@4.17.1 for npm, and for apt we can just pass the package
  command?: string;       // Used if type is 'shell'
  
  // Environment Isolation
  targetPath?: string;    // IF defined, the step runs isolated in this directory (e.g., /workspace/api)
  isGlobal?: boolean;     // For npm/pip: true = global system install, false = local to targetPath

  // this is for the versioning (for the language)
  version?: string;     // should default to latest if not provided
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  baseImage: string; // e.g., 'ubuntu:22.04' or 'node:18'
  buildSteps: BuildStep[]; 
  bootUpAsRoot?: boolean;   // boot up the image as root
  env?: Record<string,string>;  // e.g. {"PORT":"3000","NODE_ENV":"development"}
  platform?: 'linux/amd64' | 'linux/arm64'; // Support for M-series Macs or standard Linux
  timeout?: number; // Max build time in seconds; fail safe to exit safely

  // Language servers to bake into the image, by EDITOR LANGUAGE ID (e.g. ['python','rust']).
  // The single source of truth for LSP: LspInjector installs them at build time and
  // LspProxy spawns them at runtime, both off shared/languageServers.ts. An env that
  // declares none simply has no code intelligence (Monaco highlighting still works).
  languageServers?: string[];

  // Extra outbound domains this environment's sandboxes may reach at runtime, on top of
  // the package registries derived from its build steps (see network/policy.ts). This is
  // the escape hatch for the deny-default egress policy: an app that calls
  // 'api.stripe.com' declares it here, or it is blocked. Wildcards allowed ('*.acme.io').
  allowedDomains?: string[];

  // Opt-in GUI display: bakes Xvnc + software GL into the image (DisplayInjector,
  // ~100MB) and boots sandboxes with DISPLAY=:99, so GUI apps (raylib, pygame)
  // render in the editor's Display pane. Off by default — slim envs stay slim.
  displaySupport?: boolean;
}

export const baseAliases: Record<string, string[]> = {
      'python': ['python', 'python3', 'pip', 'pip3'],
      'node': ['node', 'nodejs', 'npm'],
      'golang': ['go', 'golang']
    }

/* EXAMPLE SCHEMA

for package version, include it on the name e.g tensorflow==1.0.0
{
  "id": "zkp-noir-env",
  "name": "Zero-Knowledge Proving Environment",
  "baseImage": "ubuntu:22.04",
  "buildSteps": [
    {
      "name": "Install System Utilities & QEMU",
      "type": "apt",
      "packages": [
        "curl",
        "git",
        "build-essential",
        "qemu-system-x86",
        "python3",
        "python3-venv",
        "python3-pip"
      ]
    },
    {
      "name": "Install Global Python Tools",
      "type": "pip",
      "isGlobal": true,
      "packages": [
        "pytest",
        "black"
      ]
    },
    {
      "name": "Install Noir Prover (Custom Script)",
      "type": "shell",
      "command": "curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install.sh | bash && /root/.nargo/bin/noirup"
    },
    {
      "name": "Setup API Workspace & Local Dependencies",
      "type": "pip",
      "targetPath": "/workspace/api",
      "isGlobal": false,
      "packages": [
        "fastapi",
        "uvicorn",
        "pycryptodome"
      ]
    }
  ]
} 
  */