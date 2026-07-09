// The /environments page. Owns the env → editor boot: env-manager surfaces a
// "Launch" action (router- and sandbox-agnostic), this page hands it to the shared
// launch flow, which reuses a warm sandbox rather than booting a second one.
import React from 'react';
import { EnvManager } from '../env-manager';
import type { SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { toast } from '../notifications';
import { launchEnvironment } from './launch';
import { navigate } from './router';

export default function Environments() {
  const handleLaunch = (env: SavedEnvironment) => {
    if (!env.imageName) {
      toast.warning('Build this environment before launching.');
      return;
    }
    return launchEnvironment(env.id, {
      workspaceName: env.builderConfig?.name || env.id,
      envConfig: env.builderConfig,
    });
  };

  return <EnvManager onLaunch={handleLaunch} onViewSandboxes={() => navigate('/sandboxes')} />;
}
