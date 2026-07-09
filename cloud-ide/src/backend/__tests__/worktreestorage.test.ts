import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxManager } from '../src/services/sandbox/SandboxManager';
import { JsonSandboxRepository } from '../src/database/json/JsonSandboxRepository';

// Requires a running Rust engine + Docker; opt in explicitly so plain
// `npm test` stays green on machines without the infra.
const describeIntegration = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('Storage Engine Integration', () => {
  let sandboxManager: SandboxManager;
  let testSandboxId: string;
  let testWorktreeId: string;

  beforeAll(() => {
    // Initialize real dependencies
    const repo = new JsonSandboxRepository();
    sandboxManager = new SandboxManager(repo);
  });

  it('should provision a sandbox and create a git worktree on the SSD', async () => {
    const record = await sandboxManager.provision({ imageTag: 'ubuntu:latest', volumes: [] }, 'test-owner');
    
    testSandboxId = record.sandboxId;
    testWorktreeId = record.worktreeId;

    expect(testSandboxId).toBeDefined();
    expect(testWorktreeId).toBeDefined();

    // Verify physical file system
    const worktreePath = path.resolve(process.cwd(), `data/worktrees/${testWorktreeId}`);
    const stats = await fs.stat(worktreePath);
    
    expect(stats.isDirectory()).toBe(true);
  }, 15000); // Give it a longer timeout since it's doing real disk/Docker I/O

  it('should completely destroy the sandbox and clean up the SSD', async () => {
    const success = await sandboxManager.destroy(testSandboxId);
    expect(success).toBe(true);

    const worktreePath = path.resolve(process.cwd(), `data/worktrees/${testWorktreeId}`);
    
    // The directory should no longer exist
    await expect(fs.access(worktreePath)).rejects.toThrow();
  }, 15000);
});
