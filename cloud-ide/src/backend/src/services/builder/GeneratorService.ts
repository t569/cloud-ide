// shared/utils/services/GeneratorService.ts

import { EnvironmentConfig, BuildStep } from '../../../../shared/types/env';
import { Validator } from '../../../../shared/utils/Validator';
import { StageOrchestrator } from '../../../../pipeline/StageOrchestrator';
import { MiddlewareEngine } from '../../../../pipeline/middleware/MiddlewareEngine';
import { SecurityUserInjector } from '../../../../pipeline/middleware/injectors/SecurityUserInjector';
import { OpenSandboxInjector } from '../../../../pipeline/middleware/injectors/OpenSandboxInjector';
import { DockerfileAssembler } from '../../../../pipeline/assembler/DockerfileAssembler';

// utils
import { optimizeLayers } from '@cloud-ide/shared'
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