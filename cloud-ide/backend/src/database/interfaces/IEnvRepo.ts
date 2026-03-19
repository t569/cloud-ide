export interface Environment {
  id: string;          // e.g., 'NodeJS' (What the frontend sends)
  displayName: string; // e.g., 'Node.js v18' (For the UI)
  image: string;       // e.g., 'node:18-bullseye' (CRITICAL: What OpenSandbox needs!)
}

export interface IEnvRepo {
  /** Checks if the environment ID requested by the frontend is valid */
  exists(id: string): Promise<boolean>;
  
  /** Retrieves the full environment record so we can get the Docker image tag */
  getById(id: string): Promise<Environment | null>;
}