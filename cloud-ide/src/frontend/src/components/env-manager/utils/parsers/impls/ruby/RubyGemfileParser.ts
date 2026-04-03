// src/utils/parsers/implementations/RubyGemfileParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class RubyGemfileParser implements IFileParser {
  type: InstallStepType = 'ruby';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'gemfile';
  }

  async parse(file: File): Promise<string[]> {
    const text = await file.text();
    const packages: string[] = [];

    // Regex matches: gem "nokogiri" or gem 'rails', '~> 7.0'
    const gemRegex = /^\s*gem\s+['"]([^'"]+)['"]/gm;
    let match;

    while ((match = gemRegex.exec(text)) !== null) {
      if (match[1]) packages.push(match[1]);
    }

    return Array.from(new Set(packages));
  }
}