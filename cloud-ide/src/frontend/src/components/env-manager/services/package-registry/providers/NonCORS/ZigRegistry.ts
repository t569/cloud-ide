// src/services/package-registry/providers/ZigRegistry.ts
import type { IRegistry, PackageSearchResult } from '../../IRegistry';

export class ZigRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    const isUrl = name.startsWith('http://') || name.startsWith('https://');

    // 1. SOFT VALIDATION: If it's not a URL, warn them but allow it
    if (!isUrl) {
      return [{
        name: name,
        description: '⚠️ Zig dependencies are usually URLs to .tar.gz archives.',
        type: 'zig'
      }];
    }

    // 2. PARSE FRIENDLY NAME: If it IS a URL, let's make it look pretty in the UI
    let friendlyName = 'Tarball Archive';
    try {
      const urlObj = new URL(name);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      // E.g., https://github.com/ziglibs/zfetch/... -> extracts "zfetch"
      if (urlObj.hostname.includes('github.com') && pathParts.length >= 2) {
        friendlyName = pathParts[1]; 
      } else {
        // Fallback to the last part of the URL (often the filename)
        friendlyName = pathParts[pathParts.length - 1] || friendlyName;
      }
    } catch (e) {
      // Ignore URL parsing errors and fallback to default
    }

    // 3. Return the verified result
    return [{
      // We keep the actual URL as the 'name' so it gets saved to the schema properly
      name: name, 
      version: version || undefined,
      description: `Zig Dependency: ${friendlyName}`,
      type: 'zig',
      exactMatch: true
    }];
  }
}