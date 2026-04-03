// src/utils/parsers/DependencyParserRegistry.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { IFileParser } from './IFileParser';

// Import our concrete implementations
import { NpmJsonParser } from './impls/node/NpmJsonParser';
import { PipRequirementsParser } from './impls/python/PipRequirementsParser';
import { PipTomlParser } from './impls/python/PipTomlParser'; // (e.g., for pyproject.toml)
import { CargoTomlParser } from './impls/rust/CargoTomlParser';
import { RubyGemfileParser } from './impls/ruby/RubyGemfileParser'; // (e.g., for Gemfile)    
import { MavenPomParser } from './impls/java/maven/MavenPomParser';
import { GoModParser } from './impls/go/GoModParser';
import { ZigZonParser } from './impls/zig/ZigZonParser';
import { GradleParser } from './impls/java/gradle/GradleParser';


export class DependencyParserRegistry {
  // Register all available parsers here
  private static parsers: IFileParser[] = [
    new NpmJsonParser(),
    new PipRequirementsParser(),
    new PipTomlParser(),
    new CargoTomlParser(),
    // new (await import('./impls/java/MavenPomParser')).MavenPomParser(), // Dynamically import to avoid loading XML parser in non-Java contexts
    new RubyGemfileParser(),
    new GoModParser(),
    new MavenPomParser(),
    new ZigZonParser(),
    new GradleParser(),
  ];

  /**
   * Attempts to parse a file based on the selected package manager.
   */
  static async parseFile(file: File, type: InstallStepType): Promise<string[]> {
    // 1. Filter parsers to only those matching the current step type (e.g., 'pip')
    const relevantParsers = this.parsers.filter(p => p.type === type);

    // 2. Find the specific parser that can handle this exact file extension
    const parser = relevantParsers.find(p => p.canParse(file));

    if (!parser) {
      throw new Error(`No parser available for ${file.name} under ${type}.`);
    }

    // 3. Execute the parse logic
    return await parser.parse(file);
  }

  /**
   * Helper utility to tell the UI which file extensions are allowed for the file input.
   */
  static getAcceptedExtensions(type: InstallStepType): string {
    switch (type) {
      case 'npm': return '.json';
      case 'pip': return '.txt,.toml';
      case 'cargo': return '.toml';
      case 'maven': return '.xml';
      case 'gradle': return '.gradle';
      case 'go': return '.mod';
      case 'ruby': return 'Gemfile';
      case 'zig': return '.zon';

      default: return '*';
    }
  }
}