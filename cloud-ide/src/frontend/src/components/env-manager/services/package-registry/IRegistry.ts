// frontend/src/components/env-manager/services/package-registry/IRegistry.ts

// The interface for a package registry, 
// defining the methods that any registry implementation must provide.`
import { InstallStepType } from '@cloud-ide/shared/types/env';

export interface PackageSearchResult {
  name: string;
  version?: string;
  description?: string;
  type: InstallStepType;
  exactMatch?: boolean;
}

export interface IRegistry {
  /**
   * Searches the package registry.
   * @param name The clean name of the package (e.g., 'react')
   * @param version An optional explicit version (e.g., '18.2.0')
   */
  search(name: string, version: string | null): Promise<PackageSearchResult[]>;
}