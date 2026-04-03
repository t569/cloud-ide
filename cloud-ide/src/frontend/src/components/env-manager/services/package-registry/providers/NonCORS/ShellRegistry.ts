// src/components/env-manager/services/package-registry/providers/ShellRegistry.ts
import { IRegistry, PackageSearchResult } from '../../IRegistry';
export class ShellRegistry implements IRegistry {
  async search(name: string, version: string | null): Promise<PackageSearchResult[]> {
    return []; // Shell doesn't use the package array anyway
  }
}
