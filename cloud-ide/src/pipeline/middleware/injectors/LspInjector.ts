// pipeline/middleware/injectors/LspInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';
import { languageServerSpec } from '../../../shared/languageServers';

/** Marks the step we own, so a second pass replaces it instead of stacking another. */
const STEP_NAME = 'Install Language Servers';

/**
 * Bakes the env's declared language servers into the runtime image.
 *
 * This is what makes `languageServers: ['python','rust']` on an EnvironmentConfig
 * actually mean something: the server ends up INSIDE the sandbox, next to the
 * interpreter and the package cache it has to resolve against. LspProxy then spawns
 * it over docker-exec stdio, reading the SAME table (shared/languageServers.ts) for
 * the argv — so build and runtime cannot drift.
 *
 * APPENDED, not unshifted: the install is the last layer, after the env's own
 * dependency steps. Adding a language server therefore doesn't invalidate the
 * (expensive) pip/npm/apt layers above it. It lands before the assembler's
 * `USER sandbox-user`, so it still runs as root.
 *
 * Idempotent: injecting twice replaces our step rather than appending a second one.
 * An unknown language id throws — a typo fails the build loudly instead of leaving
 * the editor mysteriously dumb at runtime.
 */
export class LspInjector implements PipelineInjector {
  name = 'LanguageServerInstaller';
  description = 'Installs the declared language servers into the runtime image.';

  constructor(private languages: string[] = []) {}

  inject(manifest: PipelineManifest): PipelineManifest {
    if (this.languages.length === 0) return manifest;

    const runtimeStage = manifest.stages.find((stage) => stage.role === 'runtime');
    if (!runtimeStage) return manifest;

    // Dedupe: typescript and javascript install the same server; asking for both must
    // not run `npm i -g` twice.
    const commands = [...new Set(this.languages.map((lang) => languageServerSpec(lang).install))];

    const step = {
      name: STEP_NAME,
      type: 'shell' as const,
      command: commands.join(' && '),
      isGlobal: true,
    };

    const existing = runtimeStage.steps.findIndex((s) => s.name === STEP_NAME);
    if (existing >= 0) runtimeStage.steps[existing] = step;
    else runtimeStage.steps.push(step);

    return manifest;
  }
}
