// src/services/package-registry/providers/GoRegistry.ts
import type { IRegistry, PackageSearchResult } from '../../IRegistry';
import { RegistryError } from '../../RegistryError';

export class GoRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    // 1. Pre-flight Validation: Go modules MUST look like repository paths
    if (!name.includes('/')) {
      throw new RegistryError(
        'Go modules require a repository path (e.g., github.com/gorilla/mux)', 
        'go', 
        400
      );
    }

    try {
      if (version) {
        const goVersion = version.startsWith('v') ? version : `v${version}`;
        const res = await fetch(`https://proxy.golang.org/${name}/@v/${goVersion}.info`);
        
        // 2. SOFT VALIDATION: If it's a 404/410, it might be a private or un-cached repo.
        // We DO NOT throw an error. We allow the user to add it anyway.
        if (res.status === 404 || res.status === 410) {
          return [{
            name: name,
            version: goVersion,
            description: '⚠️ Unverified/Private Module. Ensure Git access during build.',
            type: 'go',
            exactMatch: true
          }];
        }
        
        if (!res.ok) throw new RegistryError(`Go Proxy error: ${res.status}`, 'go', res.status);
        const data = await res.json(); 
        
        return [{
          name: name,
          version: data.Version,
          description: `Verified Go Module`,
          type: 'go',
          exactMatch: true
        }];
      }

      // 3. General Validation for latest versions
      const res = await fetch(`https://proxy.golang.org/${name}/@v/list`);
      
      // SOFT VALIDATION for wildcard searches
      if (res.status === 404 || res.status === 410) {
         return [{
           name: name,
           version: 'latest',
           description: '⚠️ Unverified/Private Module. Ensure Git access during build.',
           type: 'go'
         }];
      }
      
      if (!res.ok) throw new RegistryError(`Go Proxy error: ${res.status}`, 'go', res.status);

      const text = await res.text();
      const versions = text.split('\n').filter(Boolean);
      const latestVersion = versions.length > 0 ? versions[versions.length - 1] : 'latest';

      return [{
        name: name,
        version: latestVersion,
        description: `Verified Go Module`,
        type: 'go'
      }];

    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Failed to connect to Go Proxy: ${(error as Error).message}`, 'go');
    }
  }
}