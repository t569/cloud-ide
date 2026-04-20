import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxRecord,
  SandboxSpec,
  SandboxState,
  SandboxStatus,
  VolumeMount,
} from '@cloud-ide/shared/types/sandbox';
import { ISandboxRepository } from '../../database/interfaces/ISandboxRepository';
import { ExecConnectionInfo } from '../../types/engine';
import { IRustEngineClient, RustEngineClient } from './rustClient';
import { WorktreeEngine } from '../storage/WorktreeEngine';
import { WorkspaceProvisioner } from '../provisioning';
import { WorktreeStrategy } from '../provisioning/strategies/git/WorktreeStrategy';

const DEFAULT_WORKSPACE_MOUNT_PATH = '/workspace';
const USER_VOLUME_ROOT = `${DEFAULT_WORKSPACE_MOUNT_PATH}/mounts`;

export interface VolumeMutationResult {
  sandbox: SandboxRecord;
  restartRequired: boolean;
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

  private worktreeEngine: WorktreeEngine;
  constructor(
    private sandboxRepo: ISandboxRepository,
    private rustClient: IRustEngineClient = new RustEngineClient()
  ) {

    // Initialize the engine pointing to a data folder on the server
    const baseRepoPath = path.resolve(process.cwd(), 'data/central-repo.git');
    const worktreesRoot = path.resolve(process.cwd(), 'data/worktrees');
    this.worktreeEngine = new WorktreeEngine(baseRepoPath, worktreesRoot);
  }


  /**
   * @description Initiates the container provisioning sequence.
   * It dynamically generates a unique host directory for the `/workspace` 
   * bind mount, appends it to the spec, and delegates the raw boot command 
   * to the Rust engine.
   */
  public async provision(spec: SandboxSpec): Promise<SandboxRecord> {
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
    const rustStatus = await this.rustClient.bootSandbox(finalSpec);

    // 6. Save the record, explicitly linking the Rust ID to the Worktree ID
    const record: SandboxRecord = {
      sandboxId: rustStatus.sandboxId,     // The OpenSandbox ID (e.g., sbx-1234)
      worktreeId: worktreeId,              // The Host SSD folder ID (e.g., uuid)
      environmentId: spec.imageTag,
      state: rustStatus.state,
      ipAddress: rustStatus.ipAddress,
      execdPort: rustStatus.execdPort,
      desiredVolumes: finalSpec.volumes || [],
      workspaceMountPath: DEFAULT_WORKSPACE_MOUNT_PATH,
      requiresReprovision: false,
      createdAt: Date.now(),
    };

    await this.sandboxRepo.save(record);
    return record;
  }

  public async getRecord(sandboxId: string): Promise<SandboxRecord | null> {
    return this.sandboxRepo.get(sandboxId);
  }


  /**
   * @description Polls the Rust engine for the true container state and 
   * reconciles it with the local persistence database.
   */
  public async getStatus(sandboxId: string): Promise<SandboxStatus> {
    const status = await this.rustClient.getSandboxStatus(sandboxId);
    const current = await this.sandboxRepo.get(sandboxId);

    if (current) {
      await this.sandboxRepo.save({
        ...current,
        state: status.state,
        ipAddress: status.ipAddress ?? current.ipAddress,
        execdPort: status.execdPort ?? current.execdPort,
      });
    }

    return status;
  }

  public async pause(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to pause ${sandboxId}...`);
    const success = await this.rustClient.pauseSandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.updateState(sandboxId, 'PAUSED');
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
    const success = await this.rustClient.resumeSandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.updateState(sandboxId, 'RUNNING');
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
  public async destroy(sandboxId: string): Promise<boolean> {
    const record = await this.getRecord(sandboxId);
    if (!record) return false;

    console.log(`[SandboxManager] Requesting Rust to destroy ${sandboxId}...`);
    const success = await this.rustClient.destroySandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.delete(sandboxId);
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
    return this.rustClient.execCommand(sandboxId, this.normalizeExecRequest(request));
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
    return this.rustClient.resolveExecConnection(sandboxId);
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
   * @description Prepares the SandboxSpec for provisioning by:
   * 1. Building the default workspace volume mount with a unique hostPath.
   * 2. Normalizing user-defined volumes (validating and setting mount paths).
   * 3. Combining them into the final spec that will be sent to the Rust engine.
   * @param spec 
   * @returns 
   */
  // DEPRECIATED - Replaced by normalizeUserVolumes and the WorktreeStrategy
  private async prepareProvisionSpec(
    spec: SandboxSpec
  ): Promise<{ spec: SandboxSpec; desiredVolumes: VolumeMount[] }> {
    const workspaceVolume = await this.buildWorkspaceVolume(spec.imageTag);
    const userVolumes = (spec.volumes || [])
      .filter((volume) => volume.kind !== 'workspace')
      .map((volume) => this.normalizeUserVolume(volume));

    const desiredVolumes = [workspaceVolume, ...userVolumes];

    return {
      spec: {
        ...spec,
        volumes: desiredVolumes,
      },
      desiredVolumes,
    };
  }

  /**
   * Replaces prepareProvisionSpec. Only normalizes extra volumes the user requested.
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
   * @description Dynamically builds the default workspace volume mount for a given environment.
   * Currently, this generates a naive, isolated empty directory on the host machine.
   * * TODO (Git Worktree Manager): Overhaul this pipeline. Instead of creating an empty 
   * folder, this method should invoke the Worktree Manager to check out a specific branch 
   * from a central bare repository, and mount that newly created worktree path directly 
   * into the container's `/workspace`.
   * @param environmentId The requested image tag used to generate the temp folder name.
   * @returns The generated VolumeMount object pointing to the host directory.
   */
  private async buildWorkspaceVolume(environmentId: string): Promise<VolumeMount> {
    const workspaceId = `${environmentId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'workspace'}-${crypto.randomUUID()}`;
    const hostPath = path.resolve(process.cwd(), 'data', 'sandboxes', workspaceId, 'workspace');
    await fs.mkdir(hostPath, { recursive: true });

    return {
      name: 'workspace',
      kind: 'workspace',
      mountPath: DEFAULT_WORKSPACE_MOUNT_PATH,
      hostPath,
      readOnly: false,
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
   * @description Normalizes a volume name by trimming whitespace and replacing invalid characters with hyphens.
   * This ensures that volume names are consistent and safe to use as directory names on the host filesystem.
   * @param name 
   * @returns 
   */
  private normalizeVolumeName(name: string): string {
    const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!normalized) {
      throw new Error('Volume name is required.');
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