// backend/src/controllers/SessionController.ts

import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { ISessionRepository, ISandboxRepository } from '../database/interfaces';
import { SandboxManager } from '../services/sandbox/SandboxManager';
import { SessionRecord } from '../database/models';
import { config } from '../config/env';

/**
 * @class SessionController
 * @description The primary entry point for the Client Control Plane. 
 * This controller manages ephemeral browser connections (Sessions) and intelligently 
 * routes them to the underlying compute nodes (Sandboxes). It is completely decoupled 
 * from the actual infrastructure execution, relying on the SandboxManager to cross 
 * the FFI boundary into Rust.
 */
export class SessionController {
  constructor(
    private systemEvents: EventEmitter,
    private sessionRepo: ISessionRepository,
    private sandboxRepo: ISandboxRepository,
    private sandboxManager: SandboxManager
  ) {}

  /**
   * @route POST /api/v1/sessions
   * @description Initiates a new user workspace connection. It utilizes "Smart Routing" 
   * to check for existing "warm" sandboxes to prevent duplicate provisioning. 
   * If no sandbox exists, it delegates a cold boot to the Rust engine.
   */
  public startSession = async (req: Request, res: Response): Promise<void> => {
    const { environmentId, userId, repoUrl } = req.body;

    if (!environmentId) {
      res.status(400).json({ error: 'Missing required field: environmentId' });
      return;
    }

    // 1. Generate a unique ID for this browser connection
    const sessionId = `sess-${crypto.randomUUID()}`;

    // 2. Get the base URL (e.g., "http://localhost:3000" or "https://api.domain.com")
    const baseUrl = config.PUBLIC_API_URL;

    // 3. Swap HTTP for WS, and HTTPS for WSS automatically!
    const baseWsUrl = baseUrl.replace(/^http/, 'ws');

    // 4. Build the final string
    const websocketUrl = `${baseWsUrl}/v1/sessions/${sessionId}/stream`;

    try {
      // 2. Log the connection attempt
      const newSession: SessionRecord = {
        sessionId,
        userId: userId || 'anonymous',
        sandboxId: '', // Will be linked shortly
        state: 'CONNECTING',
        connectedAt: Date.now(),
        lastPingAt: Date.now()
      };
      this.systemEvents.emit('session:connecting', newSession);

      // 3. THE SMART ROUTER: Do we already have a warm sandbox for this repo/user?
      let targetSandboxId: string;
      const existingSandboxes = await this.sandboxRepo.getSandboxesByEnvId(environmentId);
      const availableSandbox = existingSandboxes.find(sbx => sbx.state === 'RUNNING' || sbx.state === 'PAUSED');

      if (availableSandbox) {
        console.log(`[SessionController] Found warm sandbox: ${availableSandbox.sandboxId}`);
        targetSandboxId = availableSandbox.sandboxId;

        // If it was paused by the idle timeout, wake it up!
        if (availableSandbox.state === 'PAUSED') {
           // Assume you add a wake() method to SandboxManager that calls the Rust FFI
           // await this.sandboxManager.wake(targetSandboxId); 
        }
      } else {
        console.log(`[SessionController] No warm sandbox found. Delegating to Rust...`);
        // 4. No sandbox exists. Ask Rust to provision one natively.
        const newSandbox = await this.sandboxManager.provision({
          imageTag: environmentId,
          // If repoUrl was provided, pass it down so Rust can map the volume
        });
        targetSandboxId = newSandbox.sandboxId;
      }

      // 5. Link the session and mark it active
      this.systemEvents.emit('session:active', { sessionId, sandboxId: targetSandboxId });

      // 6. Return the connection details to the frontend
      res.status(200).json({
        message: 'Session established',
        sessionId,
        sandboxId: targetSandboxId,
        websocketUrl: websocketUrl 
      });

    } catch (error: any) {
      console.error('[SessionController Error]', error.message);
      this.systemEvents.emit('session:disconnected', sessionId);
      res.status(500).json({ error: 'Failed to establish session' });
    }
  };

  /**
   * @route DELETE /api/v1/sessions/:sessionId
   * @description Gracefully terminates a client's HTTP/WebSocket connection. 
   * Crucially, this DOES NOT destroy the underlying sandbox infrastructure, 
   * allowing the IdleSweeper to manage the compute lifecycle independently.
   */
  public disconnectSession = async (req: Request, res: Response): Promise<void> => {
    const rawSessionId = req.params.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    // Failsafe type check (FIXED)
    if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({error: 'Invalid sessionId parameter'});
        return;
    }

    try {
      const session = await this.sessionRepo.get(sessionId); 
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      
      this.systemEvents.emit('session:disconnected', sessionId);
      res.status(200).json({ message: 'Session disconnected gracefully.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}