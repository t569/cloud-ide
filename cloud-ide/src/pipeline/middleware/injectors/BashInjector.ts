// pipeline/middleware/injectors/BashInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';

/**
 * Every sandbox image MUST have /bin/bash. Not our choice: the OpenSandbox daemon copies
 * `bootstrap.sh` into the container at boot and makes it the entrypoint, and that script's
 * shebang is `#!/bin/bash`.
 *
 * When bash is missing, the kernel fails the exec of the SCRIPT (a missing interpreter
 * reports ENOENT against the script itself), so the container dies one second after start
 * with the world's most misleading error:
 *
 *     exec /opt/opensandbox/bootstrap.sh: no such file or directory   (exit 255)
 *
 * The file is right there. Bash isn't. Everything downstream then fails in a way that
 * looks unrelated: no execd, so no terminal, no `read-external`, no tool snapshot — and
 * the sandbox lands in ERROR with the workspace looking empty.
 *
 * This bit every Alpine base (`node:*-alpine`, `python:*-alpine`), which is the default
 * choice for a small Node image and thus for most "npm workspace" environments. Debian and
 * Ubuntu bases happened to ship bash, which is the only reason this wasn't caught sooner.
 *
 * The check is a no-op on a base that already has bash — `command -v bash` short-circuits
 * before any package manager runs — so this costs nothing on the images that were fine.
 */
export class BashInjector implements PipelineInjector {
  name = 'BashGuarantee';
  description = 'Guarantees /bin/bash, which the sandbox runtime bootstrap.sh requires.';

  inject(manifest: PipelineManifest): PipelineManifest {
    const runtimeStage = manifest.stages.find((stage) => stage.role === 'runtime');
    if (!runtimeStage) return manifest;

    // FRONT of the runtime stage: this must hold no matter what the user's steps do, and
    // it wants the package index the base image already ships with.
    runtimeStage.steps.unshift({
      name: 'Ensure /bin/bash (sandbox bootstrap requirement)',
      type: 'shell',
      // Try each package manager in turn; the ones that aren't installed exit 127 and fall
      // through. If a base has neither bash nor any known package manager, the build fails
      // HERE with a legible error — far better than shipping an image whose containers all
      // die at boot.
      command: [
        'command -v bash >/dev/null 2>&1',
        'apk add --no-cache bash',
        '(apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*)',
        'microdnf install -y bash',
        'dnf install -y bash',
        'yum install -y bash',
      ].join(' || '),
      isGlobal: true,
    });

    return manifest;
  }
}
