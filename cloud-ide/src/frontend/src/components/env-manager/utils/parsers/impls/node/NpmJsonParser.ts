// src/utils/parsers/implementations/NpmJsonParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class NpmJsonParser implements IFileParser {
  type: InstallStepType = 'npm';

  canParse(file: File): boolean {
    return file.name.endsWith('.json');
  }

  async parse(file: File): Promise<string[]> {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      
      // Extract dependencies and devDependencies
      const deps = Object.keys(json.dependencies || {});
      const devDeps = Object.keys(json.devDependencies || {});
      
      return Array.from(new Set([...deps, ...devDeps]));
    } catch (error) {
      console.error("Failed to parse package.json:", error);
      throw new Error("Invalid JSON format in file.");
    }
  }
}