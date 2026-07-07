// shared/utils/services/GeneratorService.ts

// FILE VALIDATOR + utils
import { Validator, optimizeLayers } from '@cloud-ide/shared';

// PIPELINE: stage orchestration, middleware injectors, assembler
import {
  StageOrchestrator,
  MiddlewareEngine,
  SecurityUserInjector,
  OpenSandboxInjector,
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

    // Phase 3: Inject custom backend requirements (Daemons, Users, Networking)
    const engine = new MiddlewareEngine()
      .use(new SecurityUserInjector())
      .use(new OpenSandboxInjector());
      
    const finalManifest = engine.execute(baseManifest);

    // Phase 4 & 5: Translate to syntax and Assemble
    const assembler = new DockerfileAssembler(finalManifest);
    
    return assembler.assemble();
  }
}