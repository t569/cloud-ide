// The sandbox runtime's bootstrap.sh is `#!/bin/bash`. An image without bash builds fine
// and then every container made from it dies at boot with
// `exec /opt/opensandbox/bootstrap.sh: no such file or directory` — which is what happened
// to every Alpine-based (i.e. every default Node) environment.
import { BashInjector } from './BashInjector';
import { PipelineManifest } from '../../types/stage';

const manifest = (): PipelineManifest => ({
  bootUpAsRoot: false,
  globalEnv: {},
  stages: [
    {
      name: 'builder',
      role: 'builder',
      baseImage: 'node:current-alpine3.24',
      steps: [],
      envVars: {},
      inboundArtifacts: [],
    },
    {
      name: 'final',
      role: 'runtime',
      baseImage: 'node:current-alpine3.24',
      steps: [{ name: 'Install vite', type: 'npm', packages: ['vite'], isGlobal: true }],
      envVars: {},
      inboundArtifacts: [],
    },
  ],
});

const runtimeSteps = (m: PipelineManifest) => m.stages.find((s) => s.role === 'runtime')!.steps;

describe('BashInjector', () => {
  it('guarantees bash before anything else in the runtime stage', () => {
    const steps = runtimeSteps(new BashInjector().inject(manifest()));

    // FIRST — a later step (or a failing one) must not be able to leave the image bashless.
    expect(steps[0].type).toBe('shell');
    expect(steps[0].command).toContain('command -v bash');
    // Alpine is the base that actually broke; apt covers the debian/ubuntu fallthrough.
    expect(steps[0].command).toContain('apk add --no-cache bash');
    expect(steps[0].command).toContain('apt-get install -y --no-install-recommends bash');
  });

  it('leaves the user’s own steps intact', () => {
    const steps = runtimeSteps(new BashInjector().inject(manifest()));
    expect(steps).toHaveLength(2);
    expect(steps[1].packages).toEqual(['vite']);
  });
});
