// src/utils/parsers/implementations/PipRequirementsParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class PipRequirementsParser implements IFileParser {
  type: InstallStepType = 'pip';

  canParse(file: File): boolean {
    return file.name === 'requirements.txt' || file.name.endsWith('.txt');
  }

  async parse(file: File): Promise<string[]> {
    const text = await file.text();
    
    return text.split('\n')
      .map(line => line.trim())
      // Ignore empty lines and Python comments (#)
      .filter(line => line && !line.startsWith('#'))
      // Optional: Strip out version pinning (==, >=) if you just want the base names, 
      // or keep them if your registry supports resolving exact versions.
      .map(line => line.split('==')[0].split('>=')[0].trim()); 
  }
}