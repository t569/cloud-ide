// shared/utils/services/GeneratorService.ts

// FILE VALIDATOR + utils
import { Validator, optimizeLayers } from '@cloud-ide/shared';

// PIPELINE: stage orchestration, middleware injectors, assembler
import {
  StageOrchestrator,
  MiddlewareEngine,
  SecurityUserInjector,
  LspInjector,
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
    // bootstrap.sh's shebang requires. See src/opensandbox/README.md audit item K.
    // Order matters (these are lowering passes): SecurityUser unshifts the useradd to
    // the FRONT of the runtime stage; Lsp appends the server install to the END, so it
    // is the last layer and adding a language server can't invalidate the pip/npm/apt
    // layers above it. Both land before the assembler's `USER sandbox-user`, so both
    // still run as root.
    const engine = new MiddlewareEngine()
      .use(new SecurityUserInjector())
      .use(new LspInjector(config.languageServers));


    const finalManifest = engine.execute(baseManifest);

    // Phase 4 & 5: Translate to syntax and Assemble
    const assembler = new DockerfileAssembler(finalManifest);
    
    return assembler.assemble();
  }
}