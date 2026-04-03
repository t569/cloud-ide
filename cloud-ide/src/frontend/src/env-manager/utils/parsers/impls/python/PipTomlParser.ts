// src/utils/parsers/implementations/PipTomlParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { parse as parseToml } from 'smol-toml';

export class PipTomlParser implements IFileParser {
  type: InstallStepType = 'pip';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'pyproject.toml';
  }

  async parse(file: File): Promise<string[]> {
    try {
      const text = await file.text();
      const tomlData: any = parseToml(text);
      const packages: string[] = [];

      // 1. Standard PEP-621 Dependencies (Array format)
      if (tomlData.project?.dependencies) {
        tomlData.project.dependencies.forEach((dep: string) => {
           // Splits 'fastapi>=0.68.0' to just 'fastapi'
           packages.push(dep.split(/[=><~^]/)[0].trim());
        });
      }

      // 2. Poetry Specific Dependencies (Object format)
      if (tomlData.tool?.poetry?.dependencies) {
         Object.keys(tomlData.tool.poetry.dependencies).forEach(dep => {
           if (dep !== 'python') packages.push(dep);
         });
      }

      return Array.from(new Set(packages));
    } catch (error) {
      console.error("Failed to parse pyproject.toml:", error);
      throw new Error("Invalid TOML format in pyproject.toml.");
    }
  }
}