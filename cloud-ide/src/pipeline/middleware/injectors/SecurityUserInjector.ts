// pipeline/middleware/injectors/SecurityUserInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';

export class SecurityUserInjector implements PipelineInjector {
  name = 'NonRootSecurityPolicy';
  description = 'Creates a restricted user and drops root privileges if requested.';

  inject(manifest: PipelineManifest): PipelineManifest {
    // If the user specifically wants root, bypass this policy
    if (manifest.bootUpAsRoot) return manifest;

    const runtimeStage = manifest.stages.find(stage => stage.role === 'runtime');
    if (!runtimeStage) return manifest;

    // Inject user creation before any local workspace builds occur.
    //
    // Create the user ONLY — do NOT chown /workspace here. /workspace does not exist at
    // build time (it's the runtime worktree bind-mount), so a build-time chown fails with
    // "cannot access '/workspace'". Runtime writability is a MOUNT concern, handled by
    // Phase 2 (0777 worktrees, mirroring the cache mount) — see docs/plans/sandbox-privileges.md.
    //
    // Idempotent (skip if the user exists) and multi-distro: Debian `useradd`, else
    // Alpine/busybox `adduser` — a display env can be built on either base, and `useradd`
    // alone would fail the BUILD (exit 127) on Alpine.
    runtimeStage.steps.unshift({
      name: 'Create Restricted Sandbox User',
      type: 'shell',
      command:
        'id -u sandbox-user >/dev/null 2>&1 || useradd -m -s /bin/bash sandbox-user 2>/dev/null || adduser -D -s /bin/bash sandbox-user',
      isGlobal: true
    });

    // Note: the actual "USER sandbox-user" Docker instruction is emitted by the assembler
    // (DockerfileAssembler, gated on `!bootUpAsRoot`); this step just preps the OS user.

    return manifest;
  }
}