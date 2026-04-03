// src/utils/parsers/implementations/CargoTomlParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { parse as parseToml } from 'smol-toml'; // Example lightweight TOML parser

export class CargoTomlParser implements IFileParser {
  type: InstallStepType = 'cargo';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'cargo.toml' || file.name.endsWith('.toml');
  }

  async parse(file: File): Promise<string[]> {
    try {
      const text = await file.text();
      const tomlData: any = parseToml(text);
      
      const deps = Object.keys(tomlData.dependencies || {});
      const devDeps = Object.keys(tomlData['dev-dependencies'] || {});
      
      return Array.from(new Set([...deps, ...devDeps]));
    } catch (error) {
      console.error("Failed to parse Cargo.toml:", error);
      throw new Error("Invalid TOML format in file.");
    }
  }
}