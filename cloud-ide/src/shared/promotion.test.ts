// Self-check for the promoted config. The failure modes that matter: overwriting the env
// you promoted FROM, silently losing its language servers, or emitting an empty install
// step that fails the build.
import { composePromotedConfig, driftToBuildSteps } from './promotion';
import { EnvironmentConfig } from './types/env';

const source: EnvironmentConfig = {
  id: 'py-base',
  name: 'Python Base',
  baseImage: 'python:3.11',
  buildSteps: [{ name: 'Base deps', type: 'pip', packages: ['requests==2.32.3'] }],
  languageServers: ['python'],
};

const noDrift = { apt: [], pip: [], npm: [] };

describe('driftToBuildSteps', () => {
  it('emits one step per non-empty manager', () => {
    const steps = driftToBuildSteps({ apt: ['libpq-dev'], pip: ['numpy==2.1.0'], npm: [] });
    expect(steps.map((s) => s.type)).toEqual(['apt', 'pip']);
    expect(steps[1].packages).toEqual(['numpy==2.1.0']);
  });

  it('emits nothing for an empty manager — an empty install step would fail the build', () => {
    expect(driftToBuildSteps(noDrift)).toEqual([]);
  });
});

describe('composePromotedConfig', () => {
  it('keeps the base image and appends drift AFTER the source steps', () => {
    const promoted = composePromotedConfig(source, { ...noDrift, pip: ['numpy==2.1.0'] }, 'Py + numpy');

    // Same base image: the promoted env still rebuilds from source and can take a
    // security update. That is the whole reason we don't docker-commit a blob.
    expect(promoted.baseImage).toBe('python:3.11');
    // Drift last, so it lands in its own late layer and can't invalidate the one above.
    expect(promoted.buildSteps.map((s) => s.name)).toEqual(['Base deps', 'Promoted: Python packages']);
  });

  it('clears the id so promoting cannot overwrite the source environment', () => {
    expect(composePromotedConfig(source, noDrift, 'Copy').id).toBe('');
  });

  it('carries the language servers forward', () => {
    // Losing these is silent: the editor just goes dumb and nobody knows why.
    const promoted = composePromotedConfig(source, noDrift, 'Copy');
    expect(promoted.languageServers).toEqual(['python']);
    // …by value, not by reference — editing the promoted env must not mutate the source.
    promoted.languageServers!.push('rust');
    expect(source.languageServers).toEqual(['python']);
  });
});
