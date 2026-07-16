// pipeline/middleware/injectors/DisplayInjector.ts
import { PipelineInjector } from '../types';
import { PipelineManifest } from '../../types/stage';

/**
 * Opt-in GUI display stack (display-streaming plan, slice 3): Xvnc (an X server
 * and VNC server in one process), software OpenGL (llvmpipe — raylib/GLFW get a
 * GL context with no GPU), and keymaps. ~100MB, which is why it is a per-env
 * toggle and not a BashInjector-style guarantee.
 *
 * Appended to the END of the runtime stage: toggling display support only adds
 * or drops the LAST layer, so the user's apt/pip/npm layers above stay cached.
 *
 * Debian/Ubuntu first (every default golang/python/node base), Alpine attempted
 * as a fallback; anything else fails the BUILD with a legible message rather
 * than shipping an image whose Display pane can never work.
 */
export class DisplayInjector implements PipelineInjector {
  name = 'DisplayStack';
  description = 'Installs Xvnc + software GL for the interactive Display pane (opt-in).';

  constructor(private readonly enabled: boolean) {}

  inject(manifest: PipelineManifest): PipelineManifest {
    if (!this.enabled) return manifest;
    const runtimeStage = manifest.stages.find((stage) => stage.role === 'runtime');
    if (!runtimeStage) return manifest;

    runtimeStage.steps.push({
      name: 'GUI display stack (Xvnc + software GL) — enables the Display pane',
      type: 'shell',
      command: [
        'command -v Xvnc >/dev/null 2>&1',
        '(apt-get update && apt-get install -y --no-install-recommends tigervnc-standalone-server libgl1-mesa-dri x11-xkb-utils && rm -rf /var/lib/apt/lists/*)',
        'apk add --no-cache tigervnc mesa-dri-gallium setxkbmap',
        '{ echo "GUI display support needs a Debian/Ubuntu or Alpine base image"; exit 1; }',
      ].join(' || '),
      isGlobal: true,
    });

    return manifest;
  }
}
