jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'fixed-uuid'),
}));

import { SandboxManager } from '../src/services/sandbox/SandboxManager';
import { WorktreeEngine } from '../src/services/storage/WorktreeEngine';
import { ISandboxRepository } from '../src/database/interfaces/ISandboxRepository';
import { ISandboxDriver } from '../src/services/sandbox/drivers/ISandboxDriver';
import { SandboxRecord, SandboxSpec } from '@cloud-ide/shared/types/sandbox';

function createRepoMock(): jest.Mocked<ISandboxRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(undefined),
    updateState: jest.fn().mockResolvedValue(undefined),
    getSandboxesByEnvId: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue([]),
  };
}

function createRustMock(): jest.Mocked<ISandboxDriver> {
  return {
    bootSandbox: jest.fn(),
    getSandboxStatus: jest.fn(),
    execCommand: jest.fn(),
    pauseSandbox: jest.fn(),
    resumeSandbox: jest.fn(),
    destroySandbox: jest.fn(),
    resolveExecConnection: jest.fn(),
    resolveEndpoint: jest.fn(),
    capabilities: jest.fn(() => ({ exec: true, pty: false })),
  };
}

function createEngineMock(): jest.Mocked<WorktreeEngine> {
  return {
    initializeBaseRepo: jest.fn().mockResolvedValue(undefined),
    createWorktree: jest.fn().mockResolvedValue('/host/worktrees/fixed-uuid'),
    cloneInto: jest.fn().mockResolvedValue('/host/worktrees/fixed-uuid'),
    removeWorktree: jest.fn().mockResolvedValue(undefined),
    isDirty: jest.fn().mockResolvedValue(false),
    getWorktreePath: jest.fn((id: string) => `/host/worktrees/${id}`),
  } as unknown as jest.Mocked<WorktreeEngine>;
}

function makeRecord(sandboxId: string): SandboxRecord {
  return {
    sandboxId,
    worktreeId: 'wt-1',
    environmentId: 'node-env',
    state: 'RUNNING',
    execdPort: 44772,
    desiredVolumes: [],
    workspaceMountPath: '/workspace',
    requiresReprovision: false,
    createdAt: Date.now(),
  };
}

const OWNER = 'user-1'; // provision() stamps the owner used by the IDOR guard

describe('SandboxManager', () => {
  it('injects a workspace volume and normalizes user volumes under /workspace/mounts', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    const engine = createEngineMock();
    rust.bootSandbox.mockResolvedValue({
      sandboxId: 'sbx-1',
      state: 'RUNNING',
      execdPort: 44772,
    });

    const manager = new SandboxManager(repo, rust, engine);
    const spec: SandboxSpec = {
      imageTag: 'node-env:latest',
      volumes: [
        {
          name: 'logs',
          kind: 'user',
          hostPath: '/host/logs',
          mountPath: '/tmp/ignored',
          readOnly: true,
        },
      ],
    };

    const record = await manager.provision(spec, OWNER);
    const bootSpec = rust.bootSandbox.mock.calls[0][0];

    // workspace (injected), the normalized user volume, and the per-owner package cache.
    expect(bootSpec.volumes).toHaveLength(3);
    expect(bootSpec.volumes?.[0]).toMatchObject({
      name: 'git-worktree-workspace',
      kind: 'workspace',
      mountPath: '/workspace',
      readOnly: false,
    });
    expect(bootSpec.volumes?.[0].hostPath).toBe('/host/worktrees/fixed-uuid');
    expect(engine.createWorktree).toHaveBeenCalledWith('fixed-uuid');
    expect(record.worktreeId).toBe('fixed-uuid');
    expect(bootSpec.volumes?.[1]).toMatchObject({
      name: 'logs',
      kind: 'user',
      mountPath: '/workspace/mounts/logs',
      hostPath: '/host/logs',
      readOnly: true,
    });
    // A persistent per-user package cache is injected for the owner (cacheVolumes.ts).
    expect(bootSpec.volumes?.[2]).toMatchObject({
      name: 'cide-pkg-cache',
      kind: 'user',
      mountPath: '/cide-cache',
      readOnly: false,
    });
    // The owner is stamped at provision time and is the sole basis of the IDOR guard.
    expect(record.userId).toBe(OWNER);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: 'sbx-1',
        userId: OWNER,
        desiredVolumes: expect.arrayContaining([
          expect.objectContaining({ kind: 'workspace', mountPath: '/workspace' }),
          expect.objectContaining({ kind: 'user', mountPath: '/workspace/mounts/logs' }),
        ]),
        workspaceMountPath: '/workspace',
        requiresReprovision: false,
      })
    );
    expect(record.desiredVolumes).toHaveLength(3); // workspace + logs + package cache
  });

  // The daemon enforces ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ (max 63) and 400s otherwise.
  // These names all reach us from POST /sandboxes/:id/volumes, unvalidated.
  it.each([
    ['My_Data', 'my-data'],
    ['UPPER', 'upper'],
    ['weird!!name', 'weird-name'], // collapses a run of hyphens
    ['--leading', 'leading'],
    ['trailing__', 'trailing'],
    ['a'.repeat(70), 'a'.repeat(63)],
    [`${'b'.repeat(62)}-cc`, 'b'.repeat(62)], // 63-char cut lands on '-', must be stripped
  ])('coerces user volume name %s -> %s', async (input: string, expected: string) => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING', execdPort: 44772 });

    const manager = new SandboxManager(repo, rust, createEngineMock());
    await manager.provision({
      imageTag: 'node-env:latest',
      volumes: [{ name: input, kind: 'user', hostPath: '/host/x', mountPath: '/tmp/x' }],
    }, OWNER);

    const userVolume = rust.bootSandbox.mock.calls[0][0].volumes![1];
    expect(userVolume.name).toBe(expected);
    expect(userVolume.name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(userVolume.name.length).toBeLessThanOrEqual(63);
  });

  it('clone-on-create: a fresh worktree is cloned from the source, not minted empty', async () => {
    const rust = createRustMock();
    const engine = createEngineMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING', execdPort: 44772 });
    const manager = new SandboxManager(createRepoMock(), rust, engine);

    await manager.provision({ imageTag: 'node:latest' } as SandboxSpec, OWNER, undefined, {
      kind: 'clone',
      url: 'https://github.com/octocat/Hello-World.git',
      auth: { token: 'ghp_x', host: 'github.com' },
    });

    expect(engine.cloneInto).toHaveBeenCalledWith(
      'fixed-uuid',
      'https://github.com/octocat/Hello-World.git',
      { token: 'ghp_x', host: 'github.com' },
    );
    expect(engine.createWorktree).not.toHaveBeenCalled();
  });

  it('recovery ignores a clone source — an existing worktree is reused, never re-cloned', async () => {
    const rust = createRustMock();
    const engine = createEngineMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING', execdPort: 44772 });
    const manager = new SandboxManager(createRepoMock(), rust, engine);

    // existingWorktreeId present (the recover path) → clone must NOT fire, reuse wins.
    await manager.provision({ imageTag: 'node:latest' } as SandboxSpec, OWNER, 'wt-existing', {
      kind: 'clone',
      url: 'https://github.com/octocat/Hello-World.git',
    });

    expect(engine.cloneInto).not.toHaveBeenCalled();
    expect(engine.createWorktree).toHaveBeenCalledWith('wt-existing');
  });

  it('materialises a first-class workspace when a workspaceId is given (not the raw worktree)', async () => {
    const rust = createRustMock();
    const engine = createEngineMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING', execdPort: 44772 });
    const workspaces = { materialise: jest.fn().mockResolvedValue('/host/worktrees/fixed-uuid') } as any;
    const manager = new SandboxManager(createRepoMock(), rust, engine, undefined, undefined, workspaces);

    const record = await manager.provision(
      { imageTag: 'node:latest' } as SandboxSpec, OWNER, undefined, undefined, 'wsp-42',
    );

    expect(workspaces.materialise).toHaveBeenCalledWith('wsp-42', 'fixed-uuid', { fresh: true, auth: undefined });
    expect(engine.createWorktree).not.toHaveBeenCalled(); // the workspace path, not the raw worktree
    expect(engine.cloneInto).not.toHaveBeenCalled();
    expect(record.workspaceId).toBe('wsp-42');
  });

  it('rejects a workspace launch when no WorkspaceManager is wired', async () => {
    const rust = createRustMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' });
    const manager = new SandboxManager(createRepoMock(), rust, createEngineMock()); // no workspaces injected
    await expect(
      manager.provision({ imageTag: 'x' } as SandboxSpec, OWNER, undefined, undefined, 'wsp-1'),
    ).rejects.toThrow(/WorkspaceManager/);
  });

  it('rejects a volume name with nothing salvageable', async () => {
    const rust = createRustMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING', execdPort: 44772 });
    const manager = new SandboxManager(createRepoMock(), rust, createEngineMock());

    await expect(
      manager.provision({
        imageTag: 'node-env:latest',
        volumes: [{ name: '!!!', kind: 'user', hostPath: '/host/x', mountPath: '/tmp/x' }],
      }, OWNER),
    ).rejects.toThrow(/no characters valid in a DNS label/);
  });

  it('updates repository state across pause, resume, and destroy', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.pauseSandbox.mockResolvedValue(true);
    rust.resumeSandbox.mockResolvedValue(true);
    rust.destroySandbox.mockResolvedValue(true);
    repo.get.mockResolvedValue(makeRecord('sbx-2'));
    const engine = createEngineMock();

    const manager = new SandboxManager(repo, rust, engine);

    await manager.pause('sbx-2');
    await manager.resume('sbx-2');
    await manager.destroy('sbx-2');

    expect(repo.updateState).toHaveBeenNthCalledWith(1, 'sbx-2', 'PAUSED');
    // resume writes the whole record: it stamps lastActiveAt alongside the state so
    // IdleSweeper's grace period won't re-pause a sandbox we just woke.
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx-2', state: 'RUNNING', lastActiveAt: expect.any(Number) }),
    );
    expect(repo.delete).toHaveBeenCalledWith('sbx-2');
    expect(engine.removeWorktree).toHaveBeenCalledWith('wt-1');
  });

  it('resume falls back to updateState when the record has vanished', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.resumeSandbox.mockResolvedValue(true);
    repo.get.mockResolvedValue(null);

    await new SandboxManager(repo, rust, createEngineMock()).resume('sbx-gone');

    expect(repo.updateState).toHaveBeenCalledWith('sbx-gone', 'RUNNING');
    expect(repo.save).not.toHaveBeenCalled();
  });

  // Regression: provision() used to store `environmentId: spec.imageTag`, while
  // getSandboxesByEnvId queries by env id. They never matched, so warm-sandbox reuse
  // silently never fired and every launch booted a second container. The tag is also
  // rebuild-unstable (content tags), so it could never have been the reuse key.
  it('stores the environment id, not the image tag, as the reuse key', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' });

    const record = await new SandboxManager(repo, rust, createEngineMock()).provision(
      { imageTag: 'cloud-ide-my-env:sha256-abc', environmentId: 'my-env' },
      OWNER,
    );

    expect(record.environmentId).toBe('my-env');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'my-env' }));
  });

  // The raw POST /v1/sandboxes verb carries no environment; the tag is all we have.
  it('falls back to the image tag when no environment id is given', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.bootSandbox.mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' });

    const record = await new SandboxManager(repo, rust, createEngineMock()).provision(
      { imageTag: 'raw-image:latest' },
      OWNER,
    );

    expect(record.environmentId).toBe('raw-image:latest');
  });

  it('rejects destroy when the worktree has uncommitted changes (1b)', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    repo.get.mockResolvedValue(makeRecord('sbx-dirty'));
    const engine = createEngineMock();
    engine.isDirty.mockResolvedValue(true);

    const manager = new SandboxManager(repo, rust, engine);

    await expect(manager.destroy('sbx-dirty')).rejects.toThrow('uncommitted changes');
    expect(rust.destroySandbox).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('force-destroys a dirty worktree when explicitly asked', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.destroySandbox.mockResolvedValue(true);
    repo.get.mockResolvedValue(makeRecord('sbx-dirty'));
    const engine = createEngineMock();
    engine.isDirty.mockResolvedValue(true);

    const manager = new SandboxManager(repo, rust, engine);

    await expect(manager.destroy('sbx-dirty', true)).resolves.toBe(true);
    expect(repo.delete).toHaveBeenCalledWith('sbx-dirty');
    expect(engine.removeWorktree).toHaveBeenCalledWith('wt-1');
  });

  it('resolves the workspace host path from the worktree record', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    repo.get.mockResolvedValue(makeRecord('sbx-5'));
    const engine = createEngineMock();

    const manager = new SandboxManager(repo, rust, engine);

    await expect(manager.getWorkspaceHostPath('sbx-5')).resolves.toBe('/host/worktrees/wt-1');
  });

  it('marks volume mutations as requiring reprovision without calling Rust', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    const current: SandboxRecord = {
      sandboxId: 'sbx-3',
      worktreeId: 'wt-3',
      environmentId: 'node-env',
      state: 'RUNNING',
      execdPort: 44772,
      desiredVolumes: [
        {
          name: 'workspace',
          kind: 'workspace',
          mountPath: '/workspace',
          hostPath: '/host/workspace',
        },
      ],
      workspaceMountPath: '/workspace',
      requiresReprovision: false,
      createdAt: Date.now(),
    };
    repo.get.mockResolvedValue(current);

    const manager = new SandboxManager(repo, rust);
    const attachResult = await manager.attachVolume('sbx-3', {
      name: 'cache',
      kind: 'user',
      hostPath: '/host/cache',
      mountPath: '/somewhere-else',
    });
    const detachResult = await manager.detachVolume('sbx-3', 'cache');

    expect(attachResult.restartRequired).toBe(true);
    expect(attachResult.sandbox.desiredVolumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cache', mountPath: '/workspace/mounts/cache' }),
      ])
    );
    expect(detachResult.restartRequired).toBe(true);
    expect(rust.bootSandbox).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('delegates buffered exec to the Rust client', async () => {
    const repo = createRepoMock();
    const rust = createRustMock();
    rust.execCommand.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });

    const manager = new SandboxManager(repo, rust);
    const result = await manager.execBuffered('sbx-4', {
      command: ['npm', 'run', 'build'],
    });

    expect(rust.execCommand).toHaveBeenCalledWith('sbx-4', {
      command: ['npm', 'run', 'build'],
      cwd: '/workspace',
      env: {},
    });
    expect(result.stdout).toBe('ok');
  });
});
