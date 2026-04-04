// backend/src/database/models.ts

// to find out more about our structure, check out shared/types/builder.t

import { EnvironmentConfig } from '@cloud-ide/shared'; 

export interface EnvironmentRecord {
  id: string;  
   // CRITICAL: The literal Docker tag OpenSandbox will use (e.g., 'drago/node-env:v1')        
  imageName: string;        
  builderConfig?: EnvironmentConfig; // Strictly bound to builder.ts!
  createdAt: number;

  // this section is for environments that track specific repos
  isRepoSpecific: boolean;
  targetRepo?: string,
  trackedTools?:string[];
}

export interface SessionRecord {
  sessionId: string;
  envId: string;       
  status: 'active' | 'paused';
  mountPath?: string;   
  createdAt: number;
  openSandboxId?: string; // the ID for our backend sandbox
}
