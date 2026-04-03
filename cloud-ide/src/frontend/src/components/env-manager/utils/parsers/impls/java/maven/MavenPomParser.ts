// src/utils/parsers/implementations/MavenPomParser.ts
import { IFileParser } from '../../../IFileParser';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { XMLParser } from 'fast-xml-parser'; // npm install fast-xml-parser

export class MavenPomParser implements IFileParser {
  type: InstallStepType = 'maven';

  canParse(file: File): boolean {
    return file.name.toLowerCase() === 'pom.xml';
  }

  async parse(file: File): Promise<string[]> {
    try {
      const text = await file.text();
      const parser = new XMLParser({ ignoreAttributes: true });
      const result = parser.parse(text);

      let deps = result?.project?.dependencies?.dependency;
      if (!deps) return [];

      // fast-xml-parser returns an object if there's only one child, or an array if multiple
      if (!Array.isArray(deps)) {
        deps = [deps];
      }

      // Map to the GroupID:ArtifactID format required by our backend registry
      return deps.map((dep: any) => `${dep.groupId}:${dep.artifactId}`);
    } catch (error) {
      console.error("Failed to parse pom.xml:", error);
      throw new Error("Invalid XML format in pom.xml.");
    }
  }
}