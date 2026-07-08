// Bridges the full WorkspaceSession across a navigation. The URL only carries
// sandboxId, but a warm boot (env-manager → editor) also has the env name +
// config to hand over. Stash it here before navigate(); AppShell reads it.
//
// ponytail: in-memory only. A cold deep-link (refresh, shared URL) finds nothing
// and falls back to { sandboxId } — the editor can fetch env details from the
// backend later (Step 9c / future). No persistence needed for a warm handoff.
import type { WorkspaceSession } from '../editor';

const pending = new Map<string, WorkspaceSession>();

export const stashSession = (session: WorkspaceSession): void => {
  pending.set(session.sandboxId, session);
};

export const getSession = (sandboxId: string): WorkspaceSession =>
  pending.get(sandboxId) ?? { sandboxId };
