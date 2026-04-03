// src/components/env-manager/services/packageApi.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';

export interface PackageSearchResult {
  name: string;
  version?: string;
  description?: string;
  type: InstallStepType;
  exactMatch?: boolean;
}

export const searchRegistry = async (query: string, type: InstallStepType): Promise<PackageSearchResult[]> => {
  const sanitizedQuery = query.trim().toLowerCase();
  if (!sanitizedQuery) return [];

  // Detect version syntax: e.g., "react@18" or "django==4.1"
  const versionMatch = sanitizedQuery.match(/^(.*?)(?:@|==)(.+)$/);
  const searchName = versionMatch ? versionMatch[1] : sanitizedQuery;
  const searchVersion = versionMatch ? versionMatch[2] : null;

  try {
    switch (type) {
      case 'npm': {
        if (searchVersion) {
          // Exact version lookup
          const res = await fetch(`https://registry.npmjs.org/${searchName}/${searchVersion}`);
          if (!res.ok) return [];
          const data = await res.json();
          return [{ name: data.name, version: data.version, description: data.description, type: 'npm', exactMatch: true }];
        }
        // General search
        const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${searchName}&size=5`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.objects.map((obj: any) => ({
          name: obj.package.name, version: obj.package.version, description: obj.package.description, type: 'npm'
        }));
      }

      case 'pip': {
        // PyPI Exact Match / Version Lookup
        const url = searchVersion 
          ? `https://pypi.org/pypi/${searchName}/${searchVersion}/json`
          : `https://pypi.org/pypi/${searchName}/json`;
        
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          return [{ name: data.info.name, version: data.info.version, description: data.info.summary, type: 'pip', exactMatch: true }];
        }
        return [];
      }

      case 'cargo': {
        if (searchVersion) {
           const res = await fetch(`https://crates.io/api/v1/crates/${searchName}/${searchVersion}`);
           if (!res.ok) return [];
           const data = await res.json();
           return [{ name: data.version.crate, version: data.version.num, description: "Exact version match", type: 'cargo', exactMatch: true }];
        }
        const res = await fetch(`https://crates.io/api/v1/crates?q=${searchName}&per_page=5`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.crates.map((c: any) => ({ name: c.name, version: c.max_version, description: c.description, type: 'cargo' }));
      }

      // Add other types that don't have public CORS APIs (Mock data for now)
      case 'apt':
      case 'go':
      case 'ruby':
      case 'maven':
      case 'zig':
      case 'shell':
      default: {
        return [{
          name: sanitizedQuery,
          description: `Simulated result. Add this if you know ${sanitizedQuery} exists.`,
          type: type
        }];
      }
    }
  } catch (error) {
    console.error(`Error searching ${type} registry:`, error);
    return [];
  }
};