// backend/src/database/models.ts

// to find out more about our structure, check out shared/types/builder.t

import { IDEEnvironmentConfig } from '@cloud-ide/shared'; 

export interface EnvironmentRecord {
  id: string;          
  name: string;        
  config: IDEEnvironmentConfig; // Strictly bound to builder.ts!
  createdAt: number;
}

export interface SessionRecord {
  sessionId: string;
  envId: string;       
  status: 'LIVE' | 'SLEEPING';
  mountPath: string;   
  createdAt: number;
}