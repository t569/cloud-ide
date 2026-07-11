// backend/src/database/models.ts

// to find out more about our structure, check out shared/types/builder.t

import { EnvironmentConfig } from '@cloud-ide/shared'; 
import { SessionRecord, SessionState } from '@cloud-ide/shared';

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
 export type { SessionRecord, SessionState};

// An audit-trail entry for a sandbox: who did what, and when. Recorded by the
// PersistenceLayer off the same systemEvents that drive state, and read back per
// sandbox for the drawer's Activity log.
export type ActivityKind = 'created' | 'state' | 'session_attached' | 'session_left';

export interface ActivityEvent {
  id: string;
  sandboxId: string;
  kind: ActivityKind;
  message: string;
  actorId?: string; // the user responsible, when one is (session/create); absent for system state changes
  at: number;
}