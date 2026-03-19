export interface SessionRecord {
  sessionId: string;      // Your internal user/project session ID
  envId: string;          // Links to the Environment table
  repoUrl: string;        // The GitHub repo they are working on
  openSandboxId?: string; // THE GOLDEN TICKET: The ID Alibaba's engine gives us
  status: 'active' | 'paused' | 'stopped';
  lastAccessed: Date;
}

export interface ISessionRepo {
  /** Finds a session by your internal ID */
  findById(sessionId: string): Promise<SessionRecord | null>;
  
  /** Creates a new session record in the database */
  create(session: Omit<SessionRecord, 'lastAccessed' | 'status'>): Promise<SessionRecord>;
  
  /** Saves the OpenSandbox ID to the database after the engine boots it */
  updateSandboxId(sessionId: string, sandboxId: string): Promise<void>;
  
  /** Lifecycle management */
  markAsActive(sessionId: string): Promise<void>;
  markAsInactive(sessionId: string): Promise<void>;
}