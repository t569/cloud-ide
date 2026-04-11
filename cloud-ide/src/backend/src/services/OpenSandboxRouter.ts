// backend/src/services/OpenSandboxRouter.ts


// this file converts our node.js requests to a format that pydantic can understand

// TODO: we need to see how we integrate this with our current rust backend
// DEPRECIATED
import { config } from '../config/env';

// --- 1. INTERNAL TYPES (What your Node App uses) ---
export interface InternalBootRequest {
  imageTag: string;
  volumes: any[];
  envVars: string[]; // e.g., ["WORKDIR=/workspace", "PORT=3000"]
}

export interface InternalBootResponse {
  sandboxId: string;
  status: string;
  createdAt: string;
}

export interface SandboxStatusResponse {
  sandboxId: string;
  state: string;       // e.g., 'Running', 'Stopped', 'Error'
  message: string;
}

// --- 2. ENGINE TYPES (What Pydantic strict-validates) ---
interface EnginePayload {
  image: { uri: string; pullPolicy: string };
  timeout: number;
  resourceLimits: { cpuCount: string; memoryMb: string };
  env: Record<string, string>;
  volumes: any[];
  entrypoint: string[];
}

export class OpenSandboxRouter {
  private apiUrl: string;

  constructor() {
    this.apiUrl = config.OPENSANDBOX_API_URL;
  }

  /**
   * Translates Node's array of "KEY=VALUE" strings into Python's required Dictionary object
   */
  private parseEnvVars(envArray: string[]): Record<string, string> {
    const envDict: Record<string, string> = {};
    envArray.forEach(envStr => {
      const [key, ...valueParts] = envStr.split('=');
      if (key) {
        envDict[key] = valueParts.join('=') || '';
      }
    });
    return envDict;
  }

/**
   * Translates Node's internal volume objects into Python's strict Pydantic volume schema
   */
  private parseVolumes(internalVolumes: any[]): any[] {
    return internalVolumes.map((vol, index) => {
      return {
        name: vol.name || `bind-mount-${index}`,
        mountPath: vol.containerPath || vol.mountPath,
        
        // THE FIX: Explicitly declare the 'host' backend object
        /*
        we can either have
        host: A physical folder on the machine running Docker.

        pvc: A Persistent Volume Claim (used in advanced cloud clusters).
        */
        host: {
          path: vol.hostPath
        },
        
        readOnly: vol.readOnly || false
      };
    });
  }
  /**
   * The Main Routing Method: Translates, Sends, and Returns mapped data
   */
  public async bootContainer(request: InternalBootRequest): Promise<InternalBootResponse> {
    // 1. MAP INTERNAL -> ENGINE FORMAT
    const enginePayload: EnginePayload = {
      image: {
        uri: request.imageTag,
        pullPolicy: "IfNotPresent"
      },
      timeout: 3600, // 1 hour default
      resourceLimits: {
        cpuCount: "1",
        memoryMb: "512"
      },
      env: this.parseEnvVars(request.envVars),
      volumes: this.parseVolumes(request.volumes),
      entrypoint: ["sleep", "infinity"] // Keeps the container alive natively
    };

    console.log(`\x1b[35m[Router]\x1b[0m Transmitting strict payload to Engine...`);

    // 2. FIRE NETWORK REQUEST
    const response = await fetch(`${this.apiUrl}/sandboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enginePayload)
    });

    const data = await response.json();

    // Catch specific engine rejection errors (like the 422s we saw earlier)
    if (!response.ok || response.status === 422) {
      console.error(`\x1b[31m[Engine Error]\x1b[0m`, JSON.stringify(data, null, 2));
      throw new Error(`OpenSandbox Engine rejected the payload: ${response.statusText}`);
    }

    // 3. MAP ENGINE -> INTERNAL FORMAT
    // Pydantic returns data.id, but our Node backend expects sandboxId
    return {
      sandboxId: data.id,
      status: data.status?.state || 'Unknown',
      createdAt: data.createdAt
    };
  }

  /**
   * GET: Fetches the real-time status of a running sandbox from the engine
   */
  public async getSandboxStatus(sandboxId: string): Promise<SandboxStatusResponse> {
    console.log(`\x1b[35m[Router]\x1b[0m Checking status for sandbox: ${sandboxId}`);

    const response = await fetch(`${this.apiUrl}/sandboxes/${sandboxId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Sandbox ${sandboxId} no longer exists on the engine.`);
      }
      throw new Error(`Failed to fetch sandbox status: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sandboxId: data.id,
      state: data.status?.state || 'Unknown',
      message: data.status?.message || 'No message provided'
    };
  }

  /**
   * DELETE: Forces the Python engine to kill and remove the Docker container
   */
  public async destroySandbox(sandboxId: string): Promise<boolean> {
    console.log(`\x1b[35m[Router]\x1b[0m Sending kill command for sandbox: ${sandboxId}`);

    const response = await fetch(`${this.apiUrl}/sandboxes/${sandboxId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    // 204 No Content or 200 OK are standard success responses for DELETE
    if (response.ok || response.status === 204) {
      console.log(`\x1b[32m[Router]\x1b[0m Sandbox ${sandboxId} successfully destroyed.`);
      return true;
    }

    // If it's already a 404, it was already deleted, which is technically a success for us
    if (response.status === 404) {
      console.log(`\x1b[33m[Router]\x1b[0m Sandbox ${sandboxId} was already gone.`);
      return true;
    }

    throw new Error(`Engine failed to delete sandbox: ${response.statusText}`);
  }

  /**
   * PAUSE: Asks the engine to freeze the Docker container state
   */
  public async pauseSandbox(sandboxId: string): Promise<boolean> {
    console.log(`\x1b[35m[Router]\x1b[0m Sending pause command for sandbox: ${sandboxId}`);

    const response = await fetch(`${this.apiUrl}/sandboxes/${sandboxId}/pause`, {
      method: 'POST', // or PUT, depending on the engine's specific API design
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok || response.status === 204) {
      console.log(`\x1b[32m[Router]\x1b[0m Sandbox ${sandboxId} successfully paused.`);
      return true;
    }

    if (response.status === 404) {
      throw new Error(`Cannot pause: Sandbox ${sandboxId} was not found on the engine.`);
    }

    throw new Error(`Engine failed to pause sandbox: ${response.statusText}`);
  }
}