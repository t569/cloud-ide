// src/services/package-registry/providers/RubyRegistry.ts
import { IRegistry, PackageSearchResult } from '../../IRegistry';
import { RegistryError } from '../../RegistryError';

export class RubyRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    try {
      // 1. URL Encode the target RubyGems API URL
      const targetUrl = encodeURIComponent(`https://rubygems.org/api/v1/search.json?query=${name}`);
      
      // 2. Route it through corsproxy.io (Very reliable for dev environments)
      const res = await fetch(`https://corsproxy.io/?${targetUrl}`);
      
      if (!res.ok) {
        throw new RegistryError(`RubyGems API error: ${res.statusText}`, 'ruby', res.status);
      }
      
      const data = await res.json();
      
      if (data.length === 0) {
        throw new RegistryError(`No gems found for '${name}'`, 'ruby', 404);
      }

      return data.slice(0, 5).map((gem: any) => ({
        name: gem.name,
        version: gem.version,
        description: gem.info?.substring(0, 80) + '...',
        type: 'ruby'
      }));
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Network failure connecting to RubyGems: ${(error as Error).message}`, 'ruby');
    }
  }
}