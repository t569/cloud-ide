// src/services/package-registry/providers/PypiRegistry.ts
import { IRegistry, PackageSearchResult } from '../../IRegistry';
import { RegistryError } from '../../RegistryError';

export class PypiRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    const url = version 
      ? `https://pypi.org/pypi/${name}/${version}/json`
      : `https://pypi.org/pypi/${name}/json`;

    try {
      const res = await fetch(url);
      
      if (res.status === 404) {
        // We throw an error instead of returning [] so the UI knows it was a definitive miss
        throw new RegistryError(`Package '${name}' not found on PyPI.`, 'pip', 404);
      }
      if (!res.ok) {
        throw new RegistryError(`PyPI responded with status: ${res.status}`, 'pip', res.status);
      }

      const data = await res.json();
      return [{ 
        name: data.info.name, 
        version: data.info.version, 
        description: data.info.summary?.substring(0, 80), 
        type: 'pip', 
        exactMatch: true 
      }];
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Failed to connect to PyPI: ${(error as Error).message}`, 'pip');
    }
  }
}