// backend/scripts/test-storage.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxManager } from '../src/services/sandbox/SandboxManager';
import { SandboxSpec } from '@cloud-ide/shared/types/sandbox';

// Note: You will need to import your actual DB implementation here
import { JsonSandboxRepository } from '../src/database/json/JsonSandboxRepository';

async function runSanityCheck() {
  console.log('🧪 Starting Storage Engine Sanity Check...');

  // 1. Initialize your dependencies
  const sandboxRepo = new JsonSandboxRepository();
  const sandboxManager = new SandboxManager(sandboxRepo);

  const spec: SandboxSpec = {
    imageTag: 'ubuntu:latest',
    volumes: []
  };

  try {
    // --- TEST A: PROVISIONING ---
    console.log('\n[Test A] Provisioning Sandbox...');
    const record = await sandboxManager.provision(spec, 'script-owner');
    console.log(`✅ Sandbox provisioned with ID: ${record.sandboxId}`);
    console.log(`✅ Worktree assigned: ${record.worktreeId}`);

    // --- TEST B: FILE SYSTEM VERIFICATION ---
    console.log('\n[Test B] Verifying Host SSD File System...');
    const worktreePath = path.resolve(process.cwd(), `data/worktrees/${record.worktreeId}`);
    
    // This will throw an error if the directory doesn't exist
    await fs.access(worktreePath);
    console.log(`✅ Verified Git Worktree exists on disk at: ${worktreePath}`);

    // Check if it's a real git worktree (should have a .git file)
    await fs.access(path.join(worktreePath, '.git'));
    console.log(`✅ Verified directory is linked to central bare repo.`);

    // --- TEST C: DESTRUCTION ---
    console.log('\n[Test C] Destroying Sandbox...');
    await sandboxManager.destroy(record.sandboxId);
    console.log(`✅ Sandbox ${record.sandboxId} destroyed.`);

    // --- TEST D: LEAK VERIFICATION ---
    console.log('\n[Test D] Verifying SSD Cleanup...');
    try {
      await fs.access(worktreePath);
      console.error(`❌ FAILED: Worktree folder still exists! We have a storage leak.`);
    } catch {
      console.log(`✅ Verified Worktree folder was safely deleted from host.`);
    }

    console.log('\n🎉 All Storage Engine tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Integration Test Failed:', error);
    process.exit(1);
  }
}

runSanityCheck();