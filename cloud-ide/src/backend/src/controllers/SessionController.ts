// backend/src/controllers/SessionController.ts

import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { ISessionRepository, ISandboxRepository, IEnvironmentRepository } from '../database/interfaces';
import { SandboxManager, specForEnvironment, WorkspaceSource } from '../services/sandbox/SandboxManager';
import { GitCredentialStore } from '../services/git/GitCredentialStore';
import { GitAuth } from '../services/storage/WorktreeEngine';
import { SessionRecord } from '../database/models';
import { config } from '../config/env';
import { SID_COOKIE, SESSION_COOKIE_OPTIONS, userOwnsSandbox } from '../api/middleware/security';
import { currentUser } from '../api/middleware/auth';

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
    private sandboxManager: SandboxManager,
    private envRepo: IEnvironmentRepository,
    // Resolves the caller's stored PAT so a clone-on-create can reach private repos.
    private credentials: GitCredentialStore,
  ) {}

  /**
   * Build a clone source from a request's `repoUrl`, or undefined when absent.
   * https(s)-ONLY at this trust boundary: git's `ext::`/`file::` transports can execute
   * commands on the host (the clone runs host-side as the gateway), so anything else is
   * rejected. Returns null to signal "reject the request" (bad URL); the caller 400s.
   */
  private async cloneSourceFor(repoUrl: unknown, userId: string): Promise<WorkspaceSource | null | undefined> {
    if (repoUrl === undefined) return undefined;
    if (typeof repoUrl !== 'string' || !/^https?:\/\//i.test(repoUrl)) return null;
    return { kind: 'clone', url: repoUrl, auth: await this.authFor(userId) };
  }

  /** The caller's stored PAT as GitAuth, or undefined — for cloning a private workspace. */
  private async authFor(userId: string): Promise<GitAuth | undefined> {
    const cred = await this.credentials.get(userId);
    return cred ? { token: cred.token, host: cred.host } : undefined;
  }

  /**
   * @route POST /api/v1/sessions
   * @description Opens a workspace. Three modes, and which one you get depends on the body:
   *
   *   { sandboxId }            → REOPEN exactly that workspace. No env matching.
   *   { environmentId }        → open my workspace for that env; cold-boot if I have none.
   *   { environmentId, fresh } → NEW workspace on that env, alongside any I already have.
   *
   * A sandbox record IS a workspace (an owner + a git worktree); the container is
   * disposable compute that `ensureRunning` re-mints onto the same worktree whenever it
   * dies. The environment is just the image a workspace booted from — NOT its identity.
   *
   * That distinction is why `sandboxId` exists. Reopening used to be expressed as
   * "connect me to this sandbox's env", which then matched the FIRST record for that env:
   * with two workspaces on one image, clicking Open on B handed you A. And with one
   * `owned[0]` slot per (user, env), a second workspace on the same image was unreachable
   * even if you provisioned it. `fresh` is the other half — it's how you get N of them.
   */
  public startSession = async (req: Request, res: Response): Promise<void> => {
    const { environmentId, sandboxId: requestedSandboxId, fresh, repoUrl, workspaceId } = req.body;
    // Identity comes from the seam, never the body — a caller that names its own
    // userId can claim any other user's warm sandboxes below.
    const userId = currentUser(req, res);

    if (!environmentId && !requestedSandboxId) {
      res.status(400).json({ error: 'Missing required field: environmentId (or sandboxId).' });
      return;
    }

    // Reopen-by-id: ownership is the whole gate here. 404 (not 403) on someone else's
    // sandbox — the same answer as a nonexistent one, so the id space stays opaque.
    if (requestedSandboxId) {
      if (!(await userOwnsSandbox(this.sandboxRepo, userId, requestedSandboxId))) {
        res.status(404).json({ error: `Sandbox '${requestedSandboxId}' not found.` });
        return;
      }
      try {
        // May return a NEW id: a container that can't be revived is replaced onto the
        // same worktree, and the caller must follow the id it gets back.
        const targetSandboxId = await this.sandboxManager.ensureRunning(requestedSandboxId);
        this.issueSession(res, targetSandboxId, userId);
      } catch (error: any) {
        console.error('[SessionController Error]', error);
        res.status(500).json({ error: `Failed to open workspace: ${error.message}` });
      }
      return;
    }

    // Gate: the environment must exist AND have a built image. imageName is '' until
    // a build succeeds; launching before then would 400 at the daemon with an opaque
    // "engine rejected boot". Fail here with an actionable message instead.
    const environment = await this.envRepo.get(environmentId);
    if (!environment) {
      res.status(404).json({ error: `Environment '${environmentId}' not found.` });
      return;
    }
    if (!environment.imageName) {
      res.status(409).json({
        error: `Environment '${environmentId}' has not been built yet. Build it before launching.`,
      });
      return;
    }

    // clone-on-create: a NEW workspace may be seeded from a git URL. Resolved once here
    // (validated + PAT attached); ignored when an existing workspace is reused below.
    const source = await this.cloneSourceFor(repoUrl, userId);
    if (source === null) {
      res.status(400).json({ error: 'repoUrl must be an http(s) git URL.' });
      return;
    }
    // Launch from a first-class WORKSPACE (workspace-entity.md): its id + the caller's PAT
    // are threaded to provision, which materialises it into the new sandbox.
    const wsId = typeof workspaceId === 'string' && workspaceId ? workspaceId : undefined;
    const wsAuth = wsId ? await this.authFor(userId) : undefined;

    try {
      let targetSandboxId: string;

      if (fresh) {
        // A SECOND workspace on the same image, deliberately. This is the whole "pool"
        // primitive: N workspaces on one env is just N of these. Nothing to adopt, no
        // new object — a workspace is a worktree, and provision() already mints one.
        console.log(`[SessionController] Fresh workspace requested on ${environmentId}.`);
        targetSandboxId = (
          await this.sandboxManager.provision(specForEnvironment(environment), userId, undefined, source, wsId, wsAuth)
        ).sandboxId;
      } else {
        // THE SMART ROUTER: do I already have a workspace on this env? Scoped to the
        // caller — reusing another user's would hand them someone else's files. Legacy
        // records carry no userId; adopt them, matching userOwnsSandbox.
        const existingSandboxes = await this.sandboxRepo.getSandboxesByEnvId(environmentId);
        const owned = existingSandboxes.filter((sbx) => !sbx.userId || sbx.userId === userId);

        // Prefer one we believe is alive; otherwise fall back to ANY record for the env.
        // A record in ERROR/STOPPED still owns the worktree that holds their files, so it
        // is the thing to recover — NOT something to ignore in favour of a cold boot,
        // which would mint an empty worktree and strand the old one (this is what wiped
        // workspaces after a long pause).
        //
        // NOTE this picks ARBITRARILY among several. That is fine as the "just open my
        // env" default, and it is exactly why reopening a SPECIFIC workspace must pass
        // `sandboxId` instead of coming through here.
        const candidate =
          owned.find((sbx) => sbx.state === 'RUNNING' || sbx.state === 'PAUSED') ?? owned[0];

        if (candidate) {
          // Reuse / resume / recover — all three live in ensureRunning, which the Resume
          // button goes through too, so launching and waking can never disagree about
          // what a stale record means. The id it returns may not be the candidate's.
          targetSandboxId = await this.sandboxManager.ensureRunning(candidate.sandboxId);
        } else {
          console.log(`[SessionController] No sandbox for this env. Cold-booting...`);
          targetSandboxId = (
            await this.sandboxManager.provision(specForEnvironment(environment), userId, undefined, source, wsId, wsAuth)
          ).sandboxId;
        }
      }

      this.issueSession(res, targetSandboxId, userId);
    } catch (error: any) {
      // Say WHY. A flat 'Failed to establish session' hid every real cause behind one
      // string — a missing image, an unrecoverable container, a daemon that refused the
      // boot all looked identical, and the only way to find out was to read the server
      // log. The causes here are our own (SandboxManager/daemon) messages, not secrets.
      console.error('[SessionController Error]', error);
      res.status(500).json({ error: `Failed to establish session: ${error.message}` });
    }
  };

  /**
   * Mint the browser's session for a sandbox that is now RUNNING, and answer the request.
   * Both routes above end here, so the cookie, the events and the response shape can
   * never drift apart between "reopen this workspace" and "launch this env".
   *
   * The session is only created once compute exists: a failed boot emits nothing, so
   * there is no CONNECTING record left behind pointing at a sandbox that never booted.
   */
  private issueSession(res: Response, sandboxId: string, userId: string): void {
    const sessionId = `sess-${crypto.randomUUID()}`;
    const websocketUrl = `${config.PUBLIC_API_URL.replace(/^http/, 'ws')}/v1/sessions/${sessionId}/stream`;

    const session: SessionRecord = {
      sessionId,
      userId,
      sandboxId,
      state: 'CONNECTING',
      connectedAt: Date.now(),
      lastPingAt: Date.now(),
    };
    this.systemEvents.emit('session:connecting', session);
    this.systemEvents.emit('session:active', { sessionId, sandboxId });

    // The session is an httpOnly cookie: it is the bearer the /api/fs ownership guard
    // checks, it never leaves JS (so XSS can't read it), and SameSite blocks cross-site use.
    res.cookie(SID_COOKIE, sessionId, SESSION_COOKIE_OPTIONS);

    res.status(200).json({ message: 'Session established', sessionId, sandboxId, websocketUrl });
  }

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