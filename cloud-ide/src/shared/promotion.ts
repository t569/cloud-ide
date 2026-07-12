// shared/promotion.ts
//
// Turn a sandbox's drift into a NEW environment config: "make what I installed a real env."
//
// Declarative on purpose. The promoted env keeps the ORIGINAL base image and expresses
// the drift as buildSteps, so it rebuilds through the normal pipeline — auditable,
// diffable, and rebasable onto a patched base image later. (A `docker commit` snapshot
// would capture more, but it is a frozen blob that can never take a security update.)
import { EnvironmentConfig, BuildStep } from './types/env';

/** Packages added to a sandbox since boot, per manager. Mirrors backend ToolSnapshot. */
export interface ToolDrift {
  apt: string[];
  pip: string[];
  npm: string[];
}

/** The buildSteps that reproduce this drift. Empty managers contribute nothing — an
 *  empty `pip install` step would just fail the build. */
export function driftToBuildSteps(drift: ToolDrift): BuildStep[] {
  const steps: BuildStep[] = [];
  if (drift.apt.length) {
    steps.push({ name: 'Promoted: system packages', type: 'apt', packages: [...drift.apt] });
  }
  if (drift.pip.length) {
    steps.push({ name: 'Promoted: Python packages', type: 'pip', packages: [...drift.pip], isGlobal: true });
  }
  if (drift.npm.length) {
    steps.push({ name: 'Promoted: Node packages', type: 'npm', packages: [...drift.npm], isGlobal: true });
  }
  return steps;
}

/**
 * Compose the promoted environment: the source env, plus the drift as extra buildSteps.
 *
 * The source's build steps come FIRST and the drift last, so the new steps land in their
 * own late layer — same rule LspInjector follows, for the same reason (the expensive
 * dependency layers above stay cached).
 *
 * `languageServers` is carried forward: a sandbox promoted from a Python env should still
 * have Python intelligence, and re-picking it by hand is the kind of silent loss nobody
 * notices until the editor is mysteriously dumb.
 *
 * `id` is cleared — this is a NEW environment, and identity is assigned on save. Reusing
 * the source id would overwrite the env you promoted FROM.
 */
export function composePromotedConfig(
  source: EnvironmentConfig,
  drift: ToolDrift,
  name: string,
): EnvironmentConfig {
  return {
    ...source,
    id: '',
    name,
    buildSteps: [...(source.buildSteps ?? []), ...driftToBuildSteps(drift)],
    languageServers: source.languageServers ? [...source.languageServers] : undefined,
  };
}
