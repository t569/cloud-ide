import { InstallStepType } from '@cloud-ide/shared/types/env';

export interface PackageSearchResult {
  name: string;
  version?: string;
  description?: string;
  type: InstallStepType;
  exactMatch?: boolean;
}

/**
 * Everything the app needs to know about one package manager, in one place.
 * Add a manager = add a file under managers/ and one line in index.ts.
 */
export interface PackageManager {
  type: InstallStepType;
  label: string;
  /** Full-color Iconify id (e.g. `logos:npm-icon`), rendered cached via @iconify/react. */
  icon: string;

  /** Search the upstream registry. Throws RegistryError on definitive failures. */
  search(name: string, version: string | null): Promise<PackageSearchResult[]>;

  // ---- Optional file import (apt/shell have none) ----
  /** Extensions/filenames for the <input accept=...> hint. */
  acceptExts?: string;
  /** Guard: does this file belong to this manager? */
  canParse?(file: File): boolean;
  /** Extract a dependency list from an uploaded manifest file. */
  parse?(file: File): Promise<string[]>;
}
