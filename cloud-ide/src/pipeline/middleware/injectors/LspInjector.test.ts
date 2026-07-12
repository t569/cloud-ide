// Self-check for the build-time half of the LSP integration. What can actually break:
// installing into the wrong stage, stacking duplicate steps on a re-run, busting the
// dependency layer cache by inserting too early, and silently ignoring a typo'd id.
import { LspInjector } from './LspInjector';
import { PipelineManifest } from '../../types/stage';

const manifest = (): PipelineManifest => ({
  bootUpAsRoot: false,
  globalEnv: {},
  stages: [
    {
      name: 'builder',
      role: 'builder',
      baseImage: 'python:3.11',
      steps: [],
      envVars: {},
      inboundArtifacts: [],
    },
    {
      name: 'final',
      role: 'runtime',
      baseImage: 'python:3.11-slim',
      steps: [{ name: 'Install deps', type: 'pip', packages: ['numpy'] }],
      envVars: {},
      inboundArtifacts: [],
    },
  ],
});

const runtimeSteps = (m: PipelineManifest) => m.stages.find((s) => s.role === 'runtime')!.steps;

describe('LspInjector', () => {
  it('appends the install to the runtime stage, AFTER the dependency steps', () => {
    const m = new LspInjector(['python']).inject(manifest());
    const steps = runtimeSteps(m);

    expect(steps).toHaveLength(2);
    // Last, not first: an added language server must not invalidate the pip layer above it.
    expect(steps[0].name).toBe('Install deps');
    expect(steps[1].command).toContain('python-lsp-server');
    // The builder stage is untouched — the server ships in the image we actually run.
    expect(m.stages.find((s) => s.role === 'builder')!.steps).toHaveLength(0);
  });

  it('de-dupes servers shared by two languages', () => {
    const m = new LspInjector(['typescript', 'javascript']).inject(manifest());
    const cmd = runtimeSteps(m)[1].command!;
    // Both map to typescript-language-server — install it once, not twice.
    expect(cmd.match(/npm install -g/g)).toHaveLength(1);
  });

  it('is idempotent — a second pass replaces the step, it does not stack', () => {
    const injector = new LspInjector(['python']);
    const m = injector.inject(injector.inject(manifest()));
    expect(runtimeSteps(m).filter((s) => s.name === 'Install Language Servers')).toHaveLength(1);
  });

  it('is a no-op when the env declares no servers', () => {
    expect(runtimeSteps(new LspInjector([]).inject(manifest()))).toHaveLength(1);
    expect(runtimeSteps(new LspInjector().inject(manifest()))).toHaveLength(1);
  });

  it('throws on an unknown language id rather than silently skipping it', () => {
    // A typo must fail the BUILD, not leave the editor mysteriously offline later.
    expect(() => new LspInjector(['pyton']).inject(manifest())).toThrow(/Unknown language server/);
  });
});
