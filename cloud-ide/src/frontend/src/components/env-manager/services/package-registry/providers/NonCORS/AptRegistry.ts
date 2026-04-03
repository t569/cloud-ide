// src/services/package-registry/providers/AptRegistry.ts
import { IRegistry, PackageSearchResult } from '../../IRegistry';

export class AptRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    // APT doesn't have a CORS web API. We return an optimistic exact match.
    return [{
      name: name,
      version: version || undefined,
      description: `System package. Will execute: apt-get install ${name}`,
      type: 'apt',
      exactMatch: true
    }];
  }
}