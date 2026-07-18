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

// A WORKSPACE: the durable half of a sandbox, decoupled from its disposable compute
// (docs/plans/workspace-entity.md). Where a sandbox is a container, a workspace is what
// SURVIVES it — a named, injectable/detachable git ref + policy. Today's per-sandbox
// worktree is the degenerate case: an unnamed, ephemeral workspace welded 1:1 to one
// sandbox. This record is what lifts it out into a first-class, reusable entity.
export type WorkspaceSourceKind = 'blank' | 'git-url' | 'host-folder';
export type WorkspacePersistence = 'persistent' | 'ephemeral';

export interface WorkspaceRecord {
  id: string;               // wsp-<uuid>
  name: string;
  ownerId: string;          // the basis of every access check, like a sandbox's userId
  /** The durable git ref that IS the saved state (e.g. refs/workspaces/<id>). */
  ref: string;
  source: WorkspaceSourceKind;
  /** For source==='git-url': the remote it was materialised from. */
  sourceUrl?: string;
  /** persistent = auto-saved, survives the container; ephemeral = dies with it. */
  persistence: WorkspacePersistence;
  createdAt: number;
  updatedAt: number;
  /** The sandbox it was last injected into — a workspace OUTLIVES its sandbox. */
  lastAttachedSandboxId?: string;
}

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