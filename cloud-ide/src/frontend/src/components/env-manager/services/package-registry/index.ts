// src/frontend/src/components/env-manager/services/package-registry/index.ts

import { RegistryFactory } from "./Registryfactory";
import { RegistryError } from "./RegistryError";
import { InstallStepType } from "@cloud-ide/shared/types/env";
import { PackageSearchResult } from "./IRegistry";


// This file serves as a central hub for all interactions with package registries (npm, PyPI, Cargo, etc.)
// Exports unified search functions
export type { PackageSearchResult };

export const searchRegistry = async (rawQuery: string, type: InstallStepType): Promise<PackageSearchResult[]> => {
  const sanitizedQuery = rawQuery.trim().toLowerCase();
  if (!sanitizedQuery) return [];

  const versionMatch = sanitizedQuery.match(/^(.*?)(?:@|==)(.+)$/);
  const searchName = versionMatch ? versionMatch[1] : sanitizedQuery;
  const searchVersion = versionMatch ? versionMatch[2] : null;

  const registry = RegistryFactory.getRegistry(type);

  // We do NOT try/catch here. We let the RegistryError bubble up to the React UI
  // so the component can display a red error boundary or toast notification.
  return await registry.search(searchName, searchVersion);
};