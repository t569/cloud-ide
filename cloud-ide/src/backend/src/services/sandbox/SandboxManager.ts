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

const DEFAULT_WORKSPACE_MOUNT_PATH = '/workspace';
const USER_VOLUME_ROOT = `${DEFAULT_WORKSPACE_MOUNT_PATH}/mounts`;

export interface VolumeMutationResult {
  sandbox: SandboxRecord;
  restartRequired: boolean;
}

/**
 * @class SandboxManager
 * @description The TypeScript bridge to the Rust/OpenSandbox control plane.
 * This service owns sandbox boot normalization, persistence, lifecycle updates,
 * buffered exec helpers, and runtime-safe volume change semantics.
 */
export class SandboxManager {
  constructor(
    private sandboxRepo: ISandboxRepository,
    private rustClient: IRustEngineClient = new RustEngineClient()
  ) {}

  public async provision(spec: SandboxSpec): Promise<SandboxRecord> {
    console.log('[SandboxManager] Delegating boot sequence to Rust Core...');

    const prepared = await this.prepareProvisionSpec(spec);
    const rustStatus = await this.rustClient.bootSandbox(prepared.spec);

    const record: SandboxRecord = {
      sandboxId: rustStatus.sandboxId,
      environmentId: spec.imageTag,
      state: rustStatus.state,
      ipAddress: rustStatus.ipAddress,
      execdPort: rustStatus.execdPort,
      desiredVolumes: prepared.desiredVolumes,
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

  public async resume(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to resume ${sandboxId}...`);
    const success = await this.rustClient.resumeSandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.updateState(sandboxId, 'RUNNING');
    }

    return success;
  }

  public async destroy(sandboxId: string): Promise<boolean> {
    console.log(`[SandboxManager] Requesting Rust to destroy ${sandboxId}...`);
    const success = await this.rustClient.destroySandbox(sandboxId);

    if (success) {
      await this.sandboxRepo.delete(sandboxId);
    }

    return success;
  }

  public async execBuffered(
    sandboxId: string,
    request: SandboxExecRequest
  ): Promise<SandboxExecResult> {
    return this.rustClient.execCommand(sandboxId, this.normalizeExecRequest(request));
  }

  public async resolveExecConnection(sandboxId: string): Promise<ExecConnectionInfo> {
    return this.rustClient.resolveExecConnection(sandboxId);
  }

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

  private normalizeVolumeName(name: string): string {
    const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!normalized) {
      throw new Error('Volume name is required.');
    }

    return normalized;
  }

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