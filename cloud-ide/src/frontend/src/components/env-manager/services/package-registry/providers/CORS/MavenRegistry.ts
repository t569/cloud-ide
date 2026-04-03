// src/services/package-registry/providers/MavenRegistry.ts


import { IRegistry, PackageSearchResult } from '../../IRegistry';
import { RegistryError } from '../../RegistryError';

export class MavenRegistry implements IRegistry {
  protected type: 'maven' | 'gradle';

  constructor(type: 'maven' | 'gradle' = 'maven') {
    this.type = type;
  }

  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    try {
      // 1. URL Encode the target Maven Solr API URL
      const targetUrl = encodeURIComponent(`https://search.maven.org/solrsearch/select?q=${name}&rows=5&wt=json`);
      
      // 2. Route it through our reliable development proxy
      const res = await fetch(`https://corsproxy.io/?${targetUrl}`);
      
      if (!res.ok) {
        throw new RegistryError(`Maven Central error: ${res.status}`, this.type, res.status);
      }

      const data = await res.json();
      
      if (data.response.numFound === 0) {
         throw new RegistryError(`Artifact '${name}' not found.`, this.type, 404);
      }

      return data.response.docs.map((doc: any) => ({
        name: `${doc.g}:${doc.a}`, // Formats to GroupID:ArtifactID (e.g., org.springframework:spring-core)
        version: doc.latestVersion,
        description: `Group: ${doc.g}`,
        type: this.type
      }));
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Network failure connecting to Maven Central: ${(error as Error).message}`, this.type);
    }
  }
}