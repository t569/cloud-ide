// backend/src/services/sandbox/opensandbox/drivers/opensandboxdriver.ts


// translates our schema into opensandbox pydantic schema


import { ISandboxProvider, SandboxSpec, SandboxStatus, SandboxState,
   VolumeMount, NetworkPolicySpec } from '@cloud-ide/shared';

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
    
    // 1.Translate Egress Rules for Openandbox's Sidecar
    let network_policy = undefined;
    if(spec.networkPolicy) {
      network_policy = {
        defaultAction: spec.networkPolicy.blockAllOterTraffic ? "deny" : "allow",
        egress: spec.networkPolicy.allowOutboundDomains.map(domain => ({
          action: "allow",
          target: domain  // OpenSandbox will handle the DNS proxy
        }))
      };
    }
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


    // Boot the Sandbox
    const response = await fetch(`${this.engineUrl}/sandboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenSandbox Engine failed to boot: ${response.statusText}`);
    }

    const data = await response.json();
    const sandboxId = data.id;

    // 3. Resolve Native Ingress URLs
    // OpenSandbox has a built-in gateway. We just ask it for the URLs.
    const previewUrls: Record<number, string> = {};
    if (spec.exposedPorts) {
      for (const port of spec.exposedPorts) {
        // TODO: IS THIS THE RIGHT ENDPOINT?
        const endpointRes = await fetch(`${this.engineUrl}/v1/sandboxes/${sandboxId}/endpoints/${port}`);
        if (endpointRes.ok) {
           const endpointData = await endpointRes.json();
           previewUrls[port] = endpointData.url; // e.g. <sandbox-id>-<port>.example.com
        }
      }
    }
    
    return {
      sandboxId: sandboxId,
      state: this.mapState(data.status?.state),
      ipAddress: data.status?.ip,
      execdPort: 44772, // Default port for the OpenSandbox exec daemon
      previewUrls: previewUrls
    };
  }

  /** GETSTATUS: get the opensandbox sandbox based on ID */
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

  /** PAUSE: Pauses the opensandbox sandbox based on ID */
  public async pause(sandboxId: string): Promise<boolean> {
    const response = await fetch(`${this.engineUrl}/sandboxes/${sandboxId}/pause`, { method: 'POST' });
    return response.ok || response.status === 204;
  }

  /** DESTROY: Destroys the opensandbox sandbox based on ID */
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

  /**
   * INGRESS: Asks the infrastructure for the public routing to a specific internal port
   */
  public async getIngressUrl(sandboxId: string, port: number): Promise<string> {
    const response = await fetch(`${this.engineUrl}/v1/sandboxes/${sandboxId}/endpoints/${port}`);

    if(!response.ok){
      throw new Error(`Failed to resolve ingress for port ${port}`);
    }

    const data = await response.json();
    return data.url; // e.g. 'https://3000-sbx123.example.com"
  }

  /**
   * INGRESS: Dynamically asks the OpenSandbox Gateway for the routed URL of an internal port.
   */
  public async exposePort(sandboxId: string, port: number): Promise<string> {
    const response = await fetch(`${this.engineUrl}/v1/sandboxes/${sandboxId}/endpoints/${port}`);
    
    if (!response.ok) {
      throw new Error(`Engine failed to route port ${port}: ${response.statusText}`);
    }
    
    const data = await response.json();
    // OpenSandbox Gateway returns the ingress URL mapping
    return data.url; 
  }

  /**
   * INGRESS CLEANUP: Tells the engine we no longer need routing for this port.
   */
  public async unexposePort(sandboxId: string, port: number): Promise<void> {
    // Note: Depending on OpenSandbox's specific version, this might be a DELETE request
    // to the endpoint mapping, or it just drops when the internal process dies.
    // We implement the explicit DELETE for strict resource cleanup.
    const response = await fetch(`${this.engineUrl}/v1/sandboxes/${sandboxId}/endpoints/${port}`, {
      method: 'DELETE'
    });

    if (!response.ok && response.status !== 404) {
      console.warn(`[Driver Warning] Failed to unexpose port ${port}`);
    }
  }

  /**
   * EGRESS: Updates the outbound firewall rules dynamically while the VM is running.
   * basically what we can allow the sandbox to connect to
   */
  public async updateEgressPolicy(sandboxId: string, policy: NetworkPolicySpec): Promise<void> {

    // 1. OpenSandbox requires us to find the sidecar's internal address first (port 18080)
    const sidecarUrl = await this.getIngressUrl(sandboxId, 18080);

    const egressRules = policy.allowOutboundDomains.map(domain => ({
      action: "allow",
      target: domain
    }));

    // 2. Patch the sidecar directly
    const response = await fetch(`${sidecarUrl}/policy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ egress: egressRules })
    });

    if (!response.ok) throw new Error("Failed to update egress policy");
  }
  
}