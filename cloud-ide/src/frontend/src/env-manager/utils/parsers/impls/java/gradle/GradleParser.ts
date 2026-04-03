// src/utils/parsers/implementations/GradleParser.ts
import { IFileParser } from '../../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class GradleParser implements IFileParser {
  type: InstallStepType = 'gradle';

  canParse(file: File): boolean {
    const name = file.name.toLowerCase();
    return name === 'build.gradle' || name === 'build.gradle.kts';
  }

  async parse(file: File): Promise<string[]> {
    const text = await file.text();
    const packages: string[] = [];

    // Regex to match configurations like:
    // implementation 'org.springframework.boot:spring-boot-starter-web:3.1.0'
    // api("com.google.guava:guava:32.1.1-jre")
    const dependencyRegex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly)\s*\(?['"]([^'"]+:[^'"]+)(?::[^'"]+)?['"]\)?/g;

    let match;
    while ((match = dependencyRegex.exec(text)) !== null) {
      if (match[1]) {
        // match[1] captures "group:artifact" or "group:artifact:version"
        // We split it to ensure we only keep group:artifact
        const parts = match[1].split(':');
        if (parts.length >= 2) {
           packages.push(`${parts[0]}:${parts[1]}`);
        }
      }
    }

    return Array.from(new Set(packages));
  }
}