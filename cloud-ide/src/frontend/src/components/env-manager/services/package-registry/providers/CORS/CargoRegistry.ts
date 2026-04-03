// frontend/src/components/env-manager/services/package-registry/providers/CargoRegistry.ts

import { IRegistry, PackageSearchResult } from '../../IRegistry';
import { RegistryError } from '../../RegistryError';

export class CargoRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    try {
      // 1. Exact Version Lookup
      if (version) {
        const res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`);
        
        if (res.status === 404) {
          throw new RegistryError(`Crate '${name}' version '${version}' not found.`, 'cargo', 404);
        }
        if (!res.ok) {
          throw new RegistryError(`Crates.io responded with status: ${res.status}`, 'cargo', res.status);
        }

        const data = await res.json();
        return [{ 
          name: data.version.crate, 
          version: data.version.num, 
          description: "Exact version match", 
          type: 'cargo', 
          exactMatch: true 
        }];
      }

      // 2. Wildcard / General Search
      const res = await fetch(`https://crates.io/api/v1/crates?q=${name}&per_page=5`);
      
      if (!res.ok) {
        throw new RegistryError(`Crates.io search failed with status: ${res.status}`, 'cargo', res.status);
      }
      
      const data = await res.json();
      
      if (data.crates.length === 0) {
         throw new RegistryError(`No crates found matching '${name}'`, 'cargo', 404);
      }

      return data.crates.map((c: any) => ({ 
        name: c.name, 
        version: c.max_version, 
        // Truncate descriptions that are too long so they don't break the UI dropdown
        description: c.description?.length > 80 ? c.description.substring(0, 80) + '...' : c.description, 
        type: 'cargo' 
      }));

    } catch (error) {
      // If it's already our custom error (like a 404), bubble it up
      if (error instanceof RegistryError) throw error;
      
      // Otherwise, it's a raw network/CORS error
      throw new RegistryError(`Network failure connecting to Crates.io: ${(error as Error).message}`, 'cargo');
    }
  }
}