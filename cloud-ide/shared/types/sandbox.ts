// shared/types/sandbox.ts

export type SandboxState = 'PROVISIONING' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR';

// TODO: add this to the container boot path
export type SandboxRuntimeType = 'docker' | 'gvisor' | 'kata-qemu' | 'kata-firecracker';

// the data structure for a volume mount
export interface VolumeMount {
  name: string;
  mountPath: string;      // Inside the container (e.g., /workspace)
  hostPath?: string;      // Physical path on the host node (if applicable)
  readOnly?: boolean;
}

// The generic instructions for booting a sandbox. 
// Notice there is NO mention of OpenSandbox here. It is pure infrastructure abstraction.
export interface SandboxSpec {
  imageTag: string;                // e.g., 'cloud-ide-zkp-noir-env:latest'
  envVars?: Record<string, string>; // e.g., { "WORKDIR": "/workspace" }
  volumes?: VolumeMount[];
  resourceLimits?: {
    cpuCount?: number;
    memoryMb?: number;
  };
  // ingress and egress: abstracted network configurations
  networkPolicy?: NetworkPolicySpec;
  exposedPorts?: number[]; // e.g. [3000, 8000]
}

// The standardized response from ANY sandbox provider
export interface SandboxStatus {
  sandboxId: string;
  state: SandboxState;
  ipAddress?: string;     // Needed later for the execd TCP connection
  execdPort?: number;     // Usually 44772 for OpenSandbox
  message?: string;
  previewUrls?: Record<number, string>; // e.g., { 3000: "http://3000-sbx123.our-domain.com" }
}

// THE MASTER INTERFACE: Every driver you ever build must implement this.
export interface ISandboxProvider {
  boot(spec: SandboxSpec): Promise<SandboxStatus>;
  pause(sandboxId: string): Promise<boolean>;
  destroy(sandboxId: string): Promise<boolean>;
  getStatus(sandboxId: string): Promise<SandboxStatus>;
}

// all the endpoints we can and cannot allow
export interface NetworkPolicySpec {
  allowOutboundDomains: string[]; // e.g., ["registry.npmjs.org", "github.com"]
  blockAllOterTraffic: boolean;
}

/**
 * We define custom endpoints for sandbox types:
 * 
 * POST /api/v1/sandboxes
 * 
 * REQUEST: 
 * {
  "environmentId": "zkp-noir-env",
  "provisioning": {
    "type": "github",
    "repoUrl": "https://github.com/t569/cloud-ide",
    "branch": "feat/opensandbox"
        }
    }
 * 
 * RESPONSE: To the froontend
 * {
  "message": "Sandbox provisioning initiated",
  "sandboxId": "sbx-8f72a9b1",
  "state": "PROVISIONING",
  "endpoints": {
    "status": "/api/v1/sandboxes/sbx-8f72a9b1/status",
    "exec": "/api/v1/sandboxes/sbx-8f72a9b1/exec"
        }
    }

    GET /api/v1/sandboxes/:sandboxId/status

    RESPONSE:
    {
  "sandboxId": "sbx-8f72a9b1",
  "state": "RUNNING",
  "message": "Container is active and workspace is provisioned."
    }

    POST /api/v1/sandboxes/:sandboxId/exec

    REQUEST:
    {
  "command": "npm run dev",
  "cwd": "/workspace"
    }

    POST /api/v1/sandboxes/:sandboxId/pause
    DELETE /api/v1/sandboxes/:sandboxId

    RESPONSE:
    {
  "message": "Sandbox paused successfully",
  "sandboxId": "sbx-8f72a9b1",
  "state": "PAUSED"
    }
 */