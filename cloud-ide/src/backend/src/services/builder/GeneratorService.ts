// shared/utils/services/GeneratorService.ts

// FILE VALIDATOR + utils
import { Validator, optimizeLayers } from '@cloud-ide/shared';

// PIPELINE: stage orchestration, middleware injectors, assembler
import {
  StageOrchestrator,
  MiddlewareEngine,
  SecurityUserInjector,
  BashInjector,
  LspInjector,
  DisplayInjector,
  DockerfileAssembler,
} from '@cloud-ide/pipeline';


export class DockerGeneratorService {
  
  /**
   * Takes a raw JSON string from the user and outputs a production-ready Dockerfile.
   */
  public static generateDockerfile(rawJson: string): string {
    
    // Phase 1: Parse and run security/redundancy checks
    const config = Validator.parseAndValidate(rawJson);

    // Phase 1.1: Optimisation to make the image smaller and speed up build times by reducing the number of layers
    if(config.buildSteps){
      config.buildSteps = optimizeLayers(config.buildSteps);
    }

    // Phase 2: Split into Builder and Runtime stages
    const baseManifest = StageOrchestrator.generateManifest(config);

    // Phase 3: Inject custom backend requirements (Users, Networking).
    //
    // No execd injector: the OpenSandbox daemon copies `execd` and `bootstrap.sh`
    // into every sandbox at boot and rewrites the entrypoint to run them, so baking
    // execd into the image was redundant — and the `curl | bash` step it added failed
    // on any base without curl. The image's only obligation is `/bin/bash`, which
    // bootstrap.sh's shebang requires — and BashInjector is what now ENFORCES it. That
    // obligation was written down here but never checked, so an Alpine base produced a
    // perfectly good image whose every container died at boot with
    // `exec bootstrap.sh: no such file or directory`. See src/opensandbox/README.md item K.
    // Order matters (these are lowering passes): SecurityUser unshifts the useradd to the
    // FRONT of the runtime stage, then Bash unshifts ahead of even that — nothing may run
    // before bash exists; Lsp appends the server install to the END, so it is the last
    // layer and adding a language server can't invalidate the pip/npm/apt layers above it.
    // All land before the assembler's `USER sandbox-user`, so all still run as root.
    const engine = new MiddlewareEngine()
      .use(new SecurityUserInjector())
      .use(new BashInjector())
      .use(new LspInjector(config.languageServers))
      // Appends LAST so toggling GUI support never invalidates the layers above.
      .use(new DisplayInjector(!!config.displaySupport));


    const finalManifest = engine.execute(baseManifest);

    // Phase 4 & 5: Translate to syntax and Assemble
    const assembler = new DockerfileAssembler(finalManifest);
    
    return assembler.assemble();
  }
}