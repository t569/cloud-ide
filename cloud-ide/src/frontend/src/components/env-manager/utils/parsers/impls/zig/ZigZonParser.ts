// src/utils/parsers/impls/zig/ZigZonParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class ZigZonParser implements IFileParser {
  type: InstallStepType = 'zig';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'build.zig.zon';
  }

  async parse(file: File): Promise<string[]> {
    const text = await file.text();
    const packages: string[] = [];

    // 1. Isolate the dependencies block: .dependencies = .{ ... }
    const depsMatch = text.match(/\.dependencies\s*=\s*\.\{([\s\S]*?)\}/);

    if (depsMatch && depsMatch[1]) {
      const depsBlock = depsMatch[1];
      
      // 2. Extract the actual URL strings instead of the alias keys!
      // This matches: .url = "https://github.com/..."
      const urlRegex = /\.url\s*=\s*"([^"]+)"/g;
      let match;
      
      while ((match = urlRegex.exec(depsBlock)) !== null) {
        if (match[1]) packages.push(match[1]); // Pushes the full URL
      }
    }

    return Array.from(new Set(packages));
  }
}