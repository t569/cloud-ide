// components/env-manager/services/package-registry/providers/NpmRegistry.ts
import { IRegistry, PackageSearchResult } from '../../IRegistry';

export class NpmRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    try {

        // Search the exact version if specified, otherwise perform a general search
      if (version) {
        const res = await fetch(`https://registry.npmjs.org/${name}/${version}`);
        if (!res.ok) return [];
        const data = await res.json();
        return [{ 
          name: data.name, 
          version: data.version, 
          description: data.description, 
          type: 'npm', 
          exactMatch: true 
        }];
      }

      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${name}&size=5`);
      if (!res.ok) return [];
      const data = await res.json();
      
      return data.objects.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        type: 'npm'
      }));
    } catch (error) {
      console.error('NPM Registry Error:', error);
      return [];
    }
  }
}