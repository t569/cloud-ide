// shared/types/env.ts
// RECOMMENDED, we will use this from now on

// we can then add any type
export type InstallStepType = 'apt' | 'npm' | 'pip' | 'shell';

export interface BuildStep {
  name: string;           // e.g., "Install System Dependencies"
  type: InstallStepType;  
  
  // Data for the step
  packages?: string[];    // Used if type is 'apt', 'npm', or 'pip'
  command?: string;       // Used if type is 'shell'
  
  // Environment Isolation
  targetPath?: string;    // IF defined, the step runs isolated in this directory (e.g., /workspace/api)
  isGlobal?: boolean;     // For npm/pip: true = global system install, false = local to targetPath
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  baseImage: string; // e.g., 'ubuntu:22.04' or 'node:18'
  buildSteps: BuildStep[]; 
}

/* EXAMPLE SCHEMA
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