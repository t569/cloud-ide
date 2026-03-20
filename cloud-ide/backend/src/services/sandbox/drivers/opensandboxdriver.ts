// backend/src/services/sandbox/drivers/opensandboxdriver.ts


// translates our schema into opensandbox pydantic schema


import { ISandboxProvider, SandboxSpec, SandboxStatus, SandboxState, VolumeMount } from '@cloud-ide/shared';

export class OpenSandboxDriver implements ISandboxProvider {
  private engineUrl: string;    // opensandbox FastAPI backend

  // TODO: route these enviroment variables
  constructor(engineUrl: string = process.env.OPENSANDBOX_API_URL || 'http://localhost:8080') {
    this.engineUrl = engineUrl;
  }

  // Helper: Maps our generic volume array to OpenSandbox's specific schema
  private mapVolumes(volumes: VolumeMount[] = []): any[] {
    return volumes.map((vol, index) => ({
      name: vol.name || `vol-${index}`,
      mountPath: vol.mountPath,
      host: vol.hostPath ? { path: vol.hostPath } : undefined,
      readOnly: vol.readOnly || false
    }));
  }

  public async boot(spec: SandboxSpec): Promise<SandboxStatus> {
    const payload = {
      image: {
        uri: spec.imageTag,
        pullPolicy: "IfNotPresent"
      },
      timeout: 3600, // 1 hour TTL
      resourceLimits: {
        cpuCount: spec.resourceLimits?.cpuCount?.toString() || "1",
        memoryMb: spec.resourceLimits?.memoryMb?.toString() || "512"
      },
      env: spec.envVars || {},
      volumes: this.mapVolumes(spec.volumes),
      entrypoint: ["sleep", "infinity"] // Keeps the container alive
    };

    const response = await fetch(`${this.engineUrl}/sandboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenSandbox Engine failed to boot: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sandboxId: data.id,
      state: this.mapState(data.status?.state),
      ipAddress: data.status?.ip,
      execdPort: 44772, // Default port for the OpenSandbox exec daemon
    };
  }

  public async getStatus(sandboxId: string): Promise<SandboxStatus> {
    const response = await fetch(`${this.engineUrl}/sandboxes/${sandboxId}`);
    
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Sandbox ${sandboxId} not found.`);
      throw new Error(`Failed to fetch status: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sandboxId: data.id,
      state: this.mapState(data.status?.state),
      ipAddress: data.status?.ip,
      execdPort: 44772,
      message: data.status?.message
    };
  }

  public async pause(sandboxId: string): Promise<boolean> {
    const response = await fetch(`${this.engineUrl}/sandboxes/${sandboxId}/pause`, { method: 'POST' });
    return response.ok || response.status === 204;
  }

  public async destroy(sandboxId: string): Promise<boolean> {
    const response = await fetch(`${this.engineUrl}/sandboxes/${sandboxId}`, { method: 'DELETE' });
    return response.ok || response.status === 204 || response.status === 404; // 404 means it's already gone, which is a success for deletion
  }

  // Helper: Safely converts OpenSandbox engine states to our strict domain enums
  private mapState(engineState: string): SandboxState {
    const stateMap: Record<string, SandboxState> = {
      'Running': 'RUNNING',
      'Paused': 'PAUSED',
      'Pending': 'PROVISIONING',
      'Failed': 'ERROR',
      'Stopped': 'STOPPED'
    };
    return stateMap[engineState] || 'ERROR';
  }
}