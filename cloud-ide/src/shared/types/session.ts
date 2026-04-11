// shared/types/session.ts

// Pure client connection metadata

export type SessionState = 'CONNECTING' | 'ACTIVE' | "DISCONNECTED";

export interface SessionRecord {
    sessionId: string;
    userId: string;
    sandboxId: string;          // the foreign key linking to the infrastructure
    state: SessionState;
    connectedAt: number;
    lastPingAt: number;         // We will use this to determine when to puase an idle sandbox
}