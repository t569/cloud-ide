import { createHash } from 'crypto';
import { BuildStep } from '../types/env';


// this defines a hasoing function for each build step
export class StepHasher {

  public static hash(step: BuildStep): string {
    const data = JSON.stringify({
      type: step.type,
      pkgs: step.packages?.sort(), // Sort to ensure ['a','b'] === ['b','a']
      version: step.version,
      cmd: step.command,
      path: step.targetPath
    });

    // create a unique hash for each step
    return createHash('sha256').update(data).digest('hex').substring(0, 12);
  }
}