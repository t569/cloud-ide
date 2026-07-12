import crypto from 'node:crypto';
import path from 'node:path';
import { Duplex } from 'node:stream';
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxRecord,
  SandboxSpec,
  SandboxStatus,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../../database/interfaces/ISandboxRepository';
import { JsonActivityRepository } from '../../database/json/JsonActivityRepository';
import { ExecConnectionInfo } from '../../types/engine';
import { RustEngineClient } from './rustClient';
import { ISandboxDriver, DriverCapabilities, ISandboxSession, PtyOptions } from './drivers/ISandboxDriver';
import { WorktreeEngine } from '../storage/WorktreeEngine';
import { WorkspaceProvisioner } from '../provisioning';
import { WorktreeStrategy } from '../provisioning/strategies/git/WorktreeStrategy';

const DEFAULT_WORKSPACE_MOUNT_PATH = '/workspace';
const USER_VOLUME_ROOT = `${DEFAULT_WORKSPACE_MOUNT_PATH}/mounts`;

// The on-disk storage layer every worktree branches from and lives in. Exported
// because the health probe must inspect the same paths the engine actually uses —
// a second `path.resolve(cwd, 'data/worktrees')` elsewhere would silently drift.
export const CENTRAL_REPO_PATH = path.resolve(process.cwd(), 'data/central-repo.git');
export const WORKTREES_ROOT = path.resolve(process.cwd(), 'data/worktrees');

export interface VolumeMutationResult {
  sandbox: SandboxRecord;
  restartRequired: boolean;
}

/**
 * Thrown when destroy() is blocked by uncommitted changes in the sandbox's
 * worktree. Controllers map this to HTTP 409 by type, not by message text.
 */
export class DirtyWorktreeError extends Error {
  constructor(sandboxId: string) {
    super(`Sandbox ${sandboxId} has uncommitted changes in its worktree. Commit them or retry with ?force=true.`);
    this.name = 'DirtyWorktreeError';
  }
}
/**
 * @class SandboxManager
 * @description The central domain service for the Sandbox module.
 * * It acts as the bridge between the Persistence Layer (JSON/DB) and the 
 * Compute Layer (RustEngineClient). It guarantees that the state in the 
 * database perfectly mirrors the actual state of the OpenSandbox containers.
 * * Responsibilities:
 * - Boot sequence normalization (injecting default Workspaces).
 * - Lifecycle state synchronization (RUNNING, PAUSED, STOPPED).
 * - Safe volume mutation semantics (handling hostPath resolution).
 */
export class SandboxManager {

  private baseRepoReady?: Promise<void>;

  constructor(
    private sandboxRepo: ISandboxRepository,
    // The sandbox provider. Defaults to the OpenSandbox/Rust-kernel driver;
    // injectable so tests and alternate providers can swap it (see ISandboxDriver).
    private driver: ISandboxDriver = new RustEngineClient(),
    // Injected like the driver so tests and alternate storage layouts can
    // swap it; the default points at the server's data folder.
    private worktreeEngine: WorktreeEngine = new WorktreeEngine(CENTRAL_REPO_PATH, WORKTREES_ROOT),
    // Optional so the many `new SandboxManager(...)` test sites don't need it. When
    // present, records lifecycle to the drawer's Activity log. Done HERE, not off
    // systemEvents: SandboxManager writes sandbox state directly, so the
    // `sandbox:provisioned`/`state_changed` events PersistenceLayer listens for are
    // never emitted — this is the only place these transitions actually happen.
    private activityRepo?: JsonActivityRepository,
  ) {}


  /**
   * @description Initiates the container provisioning sequence.
   * It dynamically generates a unique host directory for the `/workspace`
   * bind mount, appends it to the spec, and delegates the raw boot command
   * to the Rust engine.
   *
   * `ownerId` is stamped onto the record and is the only thing the IDOR guard
   * consults later. It must come from the identity seam (api/middleware/auth),
   * never from the request body — a client-supplied owner is not an owner.
   */
  public async provision(spec: SandboxSpec, ownerId: string): Promise<SandboxRecord> {
    // 0. Ensure the central bare repo exists (memoized — runs once per process;
    // a failure resets the memo so a transient error doesn't brick provisioning)
    this.baseRepoReady ??= this.worktreeEngine.initializeBaseRepo().catch((err) => {
      this.baseRepoReady = undefined;
      throw err;
    });
    await this.baseRepoReady;

    // 1. Generate a dedicated ID for the storage layer
    const worktreeId = crypto.randomUUID();

    // 2. Request the host path from the Engine
    const hostPath = await this.worktreeEngine.createWorktree(worktreeId);

    // 3. Use your Provisioner Strategy to mutate the spec flawlessly
    const strategy = new WorktreeStrategy(hostPath);
    const provisioner = new WorkspaceProvisioner(strategy);
    const mutatedSpec = provisioner.prepareSpec(spec);
    
    // 4. Normalize any user-defined volumes (replaces prepareProvisionSpec)
    const finalSpec = this.normalizeUserVolumes(mutatedSpec);

    // 5. Boot the container via Rust
    const rustStatus = await this.driver.bootSandbox(finalSpec);

    // 6. Save the record, explicitly linking the Rust ID to the Worktree ID
    const record: SandboxRecord = {
      sandboxId: rustStatus.sandboxId,     // The OpenSandbox ID (e.g., sbx-1234)
      userId: ownerId,                     // Owner — the basis of every later access check
      worktreeId: worktreeId,              // The Host SSD folder ID (e.g., uuid)
      // The env id, not the image tag: warm-sandbox reuse looks this up by env, and
      // a content-tagged rebuild changes the tag. Falls back to the tag for the raw
      // POST /v1/sandboxes verb, which is launched from no environment.
      environmentId: spec.environmentId ?? spec.imageTag,
      state: rustStatus.state,
      execdPort: rustStatus.execdPort,
      desiredVolumes: finalSpec.volumes || [],
      workspaceMountPath: DEFAULT_WORKSPACE_MOUNT_PATH,
      requiresReprovision: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    await this.sandboxRepo.save(record);
    await this.activityRepo?.record(record.sandboxId, 'created', `Created from ${record.environmentId}`, ownerId);
    return record;
  }

  public async getRecord(sandboxId: string): Promise<SandboxRecord | null> {
    return this.sandboxRepo.get(sandboxId);
  }

  /**
   * Every sandbox this user owns (Step 12a). Legacy records with no `userId` are
   * adopted, matching `userOwnsSandbox` — delete that branch when login lands.
   *
   * ponytail: returns stored state, not a live poll of the engine. A list of N
   * sandboxes would be N FFI round-trips, and the state can only be stale in the
   * harmless direction — opening one routes through startSession, which resumes it.
   * IdleSweeper reconciles drift on its own schedule.
   */
  public async listForOwner(ownerId: string): Promise<SandboxRecord[]> {
    const all = await this.sandboxRepo.list();
    return all.filter((sbx) => !sbx.userId || sbx.userId === ownerId);
  }

  /** What the active provider can do — read by the terminal layer to choose an
   *  interactive PTY vs line-mode exec transport. */
  public capabilities(): DriverCapabilities {
    return this.driver.capabilities();
  }

  /**
   * Opens an interactive PTY session (Phase 2). Wakes a PAUSED sandbox first
   * (same wake-on-demand as exec), then delegates to the driver. Throws if the
   * active driver has no interactive support — callers gate on capabilities().
   */
  public async openTerminalSession(sandboxId: string, opts: PtyOptions): Promise<ISandboxSession> {
    if (!this.driver.openSession) {
      throw new Error('The active sandbox driver does not support interactive sessions.');
    }
    const status = await this.driver.getSandboxStatus(sandboxId);
    if (status.state === 'PAUSED') {
      await this.resume(sandboxId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return this.driver.openSession(sandboxId, opts);
  }

  /**
   * Opens a raw stdio stream to a long-lived process in the sandbox — the transport
   * for an in-container language server. Wakes a PAUSED sandbox first, same as the
   * PTY path: unlike the VFS (which reads the worktree straight off the host disk
   * and works while paused), a process needs a running container.
   *
   * Throws if the driver can't do it; LspProxy turns that into "language offline",
   * so a driver without exec streams degrades to Monaco highlighting rather than
   * breaking the editor.
   */
  public async openExecStream(sandboxId: string, command: string[]): Promise<Duplex> {
    if (!this.driver.openExecStream) {
      throw new Error('The active sandbox driver does not support exec streams.');
    }
    const status = await this.driver.getSandboxStatus(sandboxId);
    if (status.state === 'PAUSED') {
      await this.resume(sandboxId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return this.driver.openExecStream(sandboxId, command);
  }

  /**
   * @description Resolves the absolute HOST path of a sandbox's `/workspace`.
   * Because the worktree is bind-mounted into the container, host-side services
   * (the VFS, future file watchers) can operate on these files directly with
   * zero container round-trips — and even while the sandbox is PAUSED.
   */
  public async getWorkspaceHostPath(sandboxId: string): Promise<string> {
    const record = await this.getSandboxOrThrow(sandboxId);
    if (!record.worktreeId) {
      throw new Error(`Sandbox ${sandboxId} has no worktree attached.`);
    }
    return this.worktreeEngine.getWorktreePath(record.worktreeId);
  }


  /**
   * @description Polls the Rust engine for the true container state and 
   * reconciles it with the local persistence database.
   */
  public async getStatus(sandboxId: string): Promise<SandboxStatus> {
    const status = await this.driver.getSandboxStatus(sandboxId);
    const current = await this.sandboxRepo.get(sandboxId);

    if (current) {
      await this.sandboxRepo.save({
        ...current,
        state: status.state,
        execdPort: status.execdPort ?? current.execdPort,
      });
    }

    return status;
  }

  public async pause(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to pause ${sandboxId}...`);
    const success = await this.driver.pauseSandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.updateState(sandboxId, 'PAUSED');
      await this.activityRepo?.record(sandboxId, 'state', 'Paused');
    }

    return success;
  }


  /** 
   * @description Resumes a paused container.
   * @param sandboxId The ID of the sandbox to resume.
   * @returns A promise resolving to a boolean indicating success.
   */
  public async resume(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to resume ${sandboxId}...`);
    const success = await this.driver.resumeSandbox(sandboxId);

    if (success) {
      // Stamp lastActiveAt with the state, so IdleSweeper's grace period keeps its
      // hands off a sandbox we just woke — otherwise the next sweep can re-pause it
      // before the editor's SSE stream attaches, and waitForRunning hangs on PAUSED.
      const record = await this.sandboxRepo.get(sandboxId);
      if (record) {
        await this.sandboxRepo.save({ ...record, state: 'RUNNING', lastActiveAt: Date.now() });
      } else {
        await this.sandboxRepo.updateState(sandboxId, 'RUNNING');
      }
      await this.activityRepo?.record(sandboxId, 'state', 'Resumed');
    }

    return success;
  }


  /**
   * @description Destroys the container and removes the record from the database.
   * * Architecture Note: If the Node process crashes after Rust destroys the container 
   * but before the DB updates, a "ghost record" remains. Because our future storage 
   * layer (Git Worktrees) persists code on the host SSD rather than inside the container, 
   * this state inconsistency does not result in data loss.
   * * TODO: Implement a self-healing reconciliation loop in `IdleSweeper.ts` to automatically 
   * delete DB records if the Rust engine returns a 404 Not Found.
   * @param sandboxId The ID of the sandbox to destroy.
   * @returns A promise resolving to a boolean indicating success.
   */
  public async destroy(sandboxId: string, force = false): Promise<boolean> {
    const record = await this.getRecord(sandboxId);
    if (!record) return false;

    // Pre-flight (1b): refuse to destroy a sandbox whose worktree has
    // uncommitted changes unless the caller explicitly forces it.
    if (!force && record.worktreeId && await this.worktreeEngine.isDirty(record.worktreeId)) {
      throw new DirtyWorktreeError(sandboxId);
    }

    console.log(`[SandboxManager] Requesting Rust to destroy ${sandboxId}...`);
    const success = await this.driver.destroySandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.delete(sandboxId);
      await this.activityRepo?.deleteBySandbox(sandboxId);
      // Clean up using the dedicated worktree ID!
      if (record.worktreeId) {
          await this.worktreeEngine.removeWorktree(record.worktreeId);
      }
    }

    return success;
  }

/**
   * @description Executes a command inside the container and blocks until completion, 
   * returning the fully buffered string output.
   * * Architecture Note: Do NOT use this for user-facing terminal commands (which rely 
   * on the streaming `fetch` pipeline in `SandboxController`). This method is explicitly 
   * designed for fast, programmatic backend operations.
   * * TODO: This will be heavily utilized by the upcoming Git Worktree Manager to run 
   * silent host-to-container commands (e.g., `git status`, `mkdir -p`, file scaffolding).
   * @param sandboxId The ID of the target sandbox.
   * @param request The command payload.
   * @returns The buffered stdout/stderr strings and exit code.
   */
  public async execBuffered(
    sandboxId: string,
    request: SandboxExecRequest
  ): Promise<SandboxExecResult> {
    return this.driver.execCommand(sandboxId, this.normalizeExecRequest(request));
  }


  /**
   * @description Resolves the connection info (IP, port, access token) needed to connect to the `execd` daemon for streaming commands.
   * * The Gateway Controller uses this info to route traffic to the correct 
   * internal proxy that forwards to the container's namespace. This is a key 
   * part of the "Proxy Resolution" pattern in our architecture.
   * @param sandboxId The ID of the sandbox for which to resolve connection info.
   * @returns A promise resolving to the connection info.
   */
  public async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    return this.driver.resolveExecConnection(sandboxId);
  }


  /**
   * @description Resolves a host-routable base URL for a port inside the sandbox.
   * Used by the preview ingress to proxy to a user's dev server. Providers never hand
   * out container IPs (and on Docker Desktop those wouldn't be routable anyway), so
   * this is the only way in. Rejects if nothing is listening on `port` yet.
   */
  public async resolveEndpoint(sandboxId: string, port: number): Promise<string> {
    return this.driver.resolveEndpoint(sandboxId, port);
  }


  /**
   * @description Injects a new volume mount into the Sandbox record.
   * Note: OpenSandbox/Docker cannot hot-swap bind mounts on running containers. 
   * This flags `requiresReprovision: true` so the client knows a restart is needed.
   */
  public async attachVolume(sandboxId: string, volume: VolumeMount): Promise<VolumeMutationResult> {
    const record = await this.getSandboxOrThrow(sandboxId);
    const normalized = this.normalizeUserVolume(volume);
    const desiredVolumes = [
      ...record.desiredVolumes.filter((existing) => existing.kind === 'workspace' || existing.name !== normalized.name),
      normalized,
    ];

    const updated: SandboxRecord = {
      ...record,
      desiredVolumes,
      requiresReprovision: true,
    };

    await this.sandboxRepo.save(updated);
    return { sandbox: updated, restartRequired: true };
  }


  /**
   * @description Removes a volume mount from the Sandbox record.
   * Similar to `attachVolume`, this also flags `requiresReprovision: true` since 
   * the underlying container needs to be restarted for the change to take effect.
   * @param sandboxId 
   * @param volumeName 
   * @returns 
   */
  public async detachVolume(sandboxId: string, volumeName: string): Promise<VolumeMutationResult> {
    const record = await this.getSandboxOrThrow(sandboxId);
    const desiredVolumes = record.desiredVolumes.filter(
      (volume) => volume.kind === 'workspace' || volume.name !== volumeName
    );

    const updated: SandboxRecord = {
      ...record,
      desiredVolumes,
      requiresReprovision: true,
    };

    await this.sandboxRepo.save(updated);
    return { sandbox: updated, restartRequired: true };
  }

  private async getSandboxOrThrow(sandboxId: string): Promise<SandboxRecord> {
    const sandbox = await this.sandboxRepo.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found.`);
    }

    return sandbox;
  }


  /**
   * Normalizes the extra volumes the user requested (the workspace volume is
   * supplied by the WorktreeStrategy during provision()).
   */
  private normalizeUserVolumes(spec: SandboxSpec): SandboxSpec {
    const userVolumes = (spec.volumes || [])
      .filter((volume) => volume.kind !== 'workspace')
      .map((volume) => this.normalizeUserVolume(volume));

    const workspaceVolume = spec.volumes?.find(v => v.kind === 'workspace');
    
    return {
      ...spec,
      volumes: workspaceVolume ? [workspaceVolume, ...userVolumes] : userVolumes,
    };
  }

  /**
   * @description Normalizes a user-defined volume mount by validating its properties and setting a consistent mount path within the container. 
   * User volumes cannot mount directly to `/workspace` to prevent conflicts with the default workspace volume. 
   * Instead, they are mounted under `/workspace/mounts/{volumeName}`. 
   * This method also ensures that the volume name is sanitized and valid.
   * @param volume 
   * @returns 
   */
  private normalizeUserVolume(volume: VolumeMount): VolumeMount {
    const name = this.normalizeVolumeName(volume.name);
    if (!volume.hostPath) {
      throw new Error(`Volume '${name}' requires a hostPath in v1.`);
    }

    if (volume.mountPath === DEFAULT_WORKSPACE_MOUNT_PATH) {
      throw new Error('User volumes cannot mount directly to /workspace in v1.');
    }

    return {
      name,
      kind: 'user',
      hostPath: volume.hostPath,
      subPath: volume.subPath,
      readOnly: volume.readOnly ?? false,
      mountPath: `${USER_VOLUME_ROOT}/${name}`,
    };
  }

  /**
   * @description Coerces a caller-supplied volume name (POST /sandboxes/:id/volumes, so
   * untrusted) into a DNS label. The daemon enforces `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`
   * with a 63-char cap and 400s otherwise — uppercase and `_` used to slip through here
   * and fail at the engine. Normalizing can collide two names onto one; the daemon
   * rejects duplicates within a sandbox with an explicit DUPLICATE_VOLUME_NAME error.
   */
  private normalizeVolumeName(name: string): string {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+/, '')
      .slice(0, 63)        // cap first: a 63-char cut can land on a hyphen...
      .replace(/-+$/, ''); // ...so strip trailing hyphens after the cut, not before.

    if (!normalized) {
      throw new Error(`Volume name '${name}' contains no characters valid in a DNS label.`);
    }

    return normalized;
  }

  /** 
   * @description Normalizes the SandboxExecRequest by ensuring required fields are present and setting defaults for optional fields.
   * This guarantees that the Rust engine always receives a well-formed request object, simplifying error handling on the Rust side.
   * @param request 
   * @returns
   */
  private normalizeExecRequest(request: SandboxExecRequest): SandboxExecRequest {
    if (!request.command || request.command.length === 0) {
      throw new Error('Exec request requires at least one command segment.');
    }

    return {
      command: request.command,
      cwd: request.cwd || DEFAULT_WORKSPACE_MOUNT_PATH,
      env: request.env || {},
    };
  }
}