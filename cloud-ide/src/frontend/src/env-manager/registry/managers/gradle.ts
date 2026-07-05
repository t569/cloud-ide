import { PackageManager } from '../types';
import { searchMavenCentral } from './maven';

export const gradle: PackageManager = {
  type: 'gradle',
  label: 'Gradle',
  icon: 'logos:gradle',
  acceptExts: '.gradle',

  search: (name) => searchMavenCentral(name, 'gradle'),

  canParse: (file) => {
    const name = file.name.toLowerCase();
    return name === 'build.gradle' || name === 'build.gradle.kts';
  },

  async parse(file) {
    const text = await file.text();
    const packages: string[] = [];
    // implementation 'group:artifact:version' / api("group:artifact") etc.
    const dependencyRegex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly)\s*\(?['"]([^'"]+:[^'"]+)(?::[^'"]+)?['"]\)?/g;
    let match;
    while ((match = dependencyRegex.exec(text)) !== null) {
      if (match[1]) {
        const parts = match[1].split(':');
        if (parts.length >= 2) packages.push(`${parts[0]}:${parts[1]}`);
      }
    }
    return Array.from(new Set(packages));
  },
};
