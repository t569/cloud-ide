import { PackageManager } from '../types';
import { RegistryError } from '../RegistryError';

export const go: PackageManager = {
  type: 'go',
  label: 'Go Modules',
  icon: 'logos:go',
  acceptExts: '.mod',

  async search(name, version) {
    // Go modules MUST look like repository paths
    if (!name.includes('/')) {
      throw new RegistryError('Go modules require a repository path (e.g., github.com/gorilla/mux)', 'go', 400);
    }

    try {
      if (version) {
        const goVersion = version.startsWith('v') ? version : `v${version}`;
        const res = await fetch(`https://proxy.golang.org/${name}/@v/${goVersion}.info`);

        // Soft validation: 404/410 may be a private/un-cached repo — allow it anyway.
        if (res.status === 404 || res.status === 410) {
          return [{ name, version: goVersion, description: '⚠️ Unverified/Private Module. Ensure Git access during build.', type: 'go', exactMatch: true }];
        }
        if (!res.ok) throw new RegistryError(`Go Proxy error: ${res.status}`, 'go', res.status);

        const data = await res.json();
        return [{ name, version: data.Version, description: 'Verified Go Module', type: 'go', exactMatch: true }];
      }

      const res = await fetch(`https://proxy.golang.org/${name}/@v/list`);
      if (res.status === 404 || res.status === 410) {
        return [{ name, version: 'latest', description: '⚠️ Unverified/Private Module. Ensure Git access during build.', type: 'go' }];
      }
      if (!res.ok) throw new RegistryError(`Go Proxy error: ${res.status}`, 'go', res.status);

      const versions = (await res.text()).split('\n').filter(Boolean);
      const latestVersion = versions.length > 0 ? versions[versions.length - 1] : 'latest';
      return [{ name, version: latestVersion, description: 'Verified Go Module', type: 'go' }];
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Failed to connect to Go Proxy: ${(error as Error).message}`, 'go');
    }
  },

  canParse: (file) => file.name.toLowerCase() === 'go.mod',

  async parse(file) {
    const lines = (await file.text()).split('\n');
    const packages: string[] = [];
    let inRequireBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      if (trimmed === 'require (') { inRequireBlock = true; continue; }
      if (inRequireBlock && trimmed === ')') { inRequireBlock = false; continue; }

      if (trimmed.startsWith('require ')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) packages.push(parts[1]);
        continue;
      }
      if (inRequireBlock) {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 0) packages.push(parts[0]);
      }
    }
    return Array.from(new Set(packages));
  },
};
