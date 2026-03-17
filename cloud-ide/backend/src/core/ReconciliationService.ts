// backend/src/core/ReconciliationService.ts
import { spawn } from 'node:child_process';
import { ISessionRepository } from '../database/ISessionRepository';

export async function scrubZombieSessions(sessionRepo: ISessionRepository): Promise<void> {
  // We only care about sessions the DB *thinks* are alive
  // TODO: write the getAllSessions()
  const allSessions = await sessionRepo.getSessionsByEnvId(''); // Assuming a method to get ALL sessions
  // (You will need to add a getAllSessions() method to your ISessionRepository)

  for (const session of allSessions) {
    if (session.status === 'LIVE') {
      // Force them back to sleeping. 
      // When the user reconnects, WebSocketManager will correctly wake them up.
      await sessionRepo.updateStatus(session.sessionId, 'SLEEPING');
      console.log(`[Kernel] Reconciled zombie session ${session.sessionId} to SLEEPING state.`);
    }
  }
}