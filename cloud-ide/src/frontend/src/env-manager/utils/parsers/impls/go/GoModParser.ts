// src/utils/parsers/implementations/GoModParser.ts
import { IFileParser } from '../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class GoModParser implements IFileParser {
  type: InstallStepType = 'go';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'go.mod';
  }

  async parse(file: File): Promise<string[]> {
    const text = await file.text();
    const packages: string[] = [];
    const lines = text.split('\n');
    let inRequireBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      if (trimmed === 'require (') {
        inRequireBlock = true;
        continue;
      }

      if (inRequireBlock && trimmed === ')') {
        inRequireBlock = false;
        continue;
      }

      // Handle single-line require: `require github.com/gin-gonic/gin v1.9.1`
      if (trimmed.startsWith('require ')) {
         const parts = trimmed.split(/\s+/);
         if (parts.length >= 2) packages.push(parts[1]);
         continue;
      }

      // Handle block entries: `github.com/gorilla/mux v1.8.0`
      if (inRequireBlock) {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 0) packages.push(parts[0]);
      }
    }

    return Array.from(new Set(packages));
  }
}