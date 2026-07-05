import { XMLParser } from 'fast-xml-parser';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { PackageManager, PackageSearchResult } from '../types';
import { RegistryError } from '../RegistryError';

// Shared by maven + gradle — both resolve against Maven Central, only the result tag differs.
export const searchMavenCentral = async (name: string, type: 'maven' | 'gradle'): Promise<PackageSearchResult[]> => {
  try {
    const targetUrl = encodeURIComponent(`https://search.maven.org/solrsearch/select?q=${name}&rows=5&wt=json`);
    const res = await fetch(`https://corsproxy.io/?${targetUrl}`);
    if (!res.ok) throw new RegistryError(`Maven Central error: ${res.status}`, type, res.status);

    const data = await res.json();
    if (data.response.numFound === 0) throw new RegistryError(`Artifact '${name}' not found.`, type, 404);

    return data.response.docs.map((doc: any) => ({
      name: `${doc.g}:${doc.a}`, // GroupID:ArtifactID
      version: doc.latestVersion,
      description: `Group: ${doc.g}`,
      type,
    }));
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw new RegistryError(`Network failure connecting to Maven Central: ${(error as Error).message}`, type);
  }
};

// Shared pom/gradle-style output: "groupId:artifactId"
const parsePom = (text: string): string[] => {
  const parser = new XMLParser({ ignoreAttributes: true });
  const result = parser.parse(text);
  let deps = result?.project?.dependencies?.dependency;
  if (!deps) return [];
  if (!Array.isArray(deps)) deps = [deps];
  return deps.map((dep: any) => `${dep.groupId}:${dep.artifactId}`);
};

export const maven: PackageManager = {
  type: 'maven',
  label: 'Maven Central',
  icon: 'logos:maven',
  acceptExts: '.xml',

  search: (name) => searchMavenCentral(name, 'maven'),

  canParse: (file) => file.name.toLowerCase() === 'pom.xml',

  async parse(file) {
    try {
      return parsePom(await file.text());
    } catch (error) {
      console.error('Failed to parse pom.xml:', error);
      throw new Error('Invalid XML format in pom.xml.');
    }
  },
};
