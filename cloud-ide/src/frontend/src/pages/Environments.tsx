// The /environments page. Owns the env → editor boot: env-manager surfaces a
// "Launch" action (router- and sandbox-agnostic), this page provisions a sandbox
// from the built image and navigates to /editor/:sandboxId with the full session.
import React from 'react';
import { EnvManager } from '../env-manager';
import type { SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { createSandbox, waitForRunning } from '../api/sandbox';
import { toast } from '../notifications';
import { navigate } from './router';
import { stashSession } from './sessionStore';

export default function Environments() {
  const handleLaunch = async (env: SavedEnvironment) => {
    if (!env.imageName) {
      toast.warning('Build this environment before launching.');
      return;
    }
    const pending = toast.warning(`Provisioning ${env.builderConfig?.name || env.id}…`, {
      duration: 0,
    });
    try {
      // envVars are applied at container boot (SandboxSpec.envVars), so the
      // terminal/exec inherits them — no per-exec injection needed.
      const rec = await createSandbox({
        imageTag: env.imageName,
        envVars: env.builderConfig?.env,
      });
      // The VFS needs a live workspace — wait for RUNNING before entering the editor.
      if (rec.state !== 'RUNNING') await waitForRunning(rec.sandboxId);
      // Hand the editor the full context; the URL only carries sandboxId.
      stashSession({
        sandboxId: rec.sandboxId,
        workspaceName: env.builderConfig?.name || env.id,
        envConfig: env.builderConfig,
      });
      toast.dismiss(pending);
      navigate(`/editor/${encodeURIComponent(rec.sandboxId)}`);
    } catch (e) {
      toast.dismiss(pending);
      toast.error(`Failed to launch: ${(e as Error).message}`);
    }
  };

  return <EnvManager onLaunch={handleLaunch} />;
}
