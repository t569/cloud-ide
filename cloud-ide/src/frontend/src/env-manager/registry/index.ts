import { InstallStepType } from '@cloud-ide/shared/types/env';
import { PackageManager, PackageSearchResult } from './types';

import { apt } from './managers/apt';
import { npm } from './managers/npm';
import { pip } from './managers/pip';
import { cargo } from './managers/cargo';
import { go } from './managers/go';
import { ruby } from './managers/ruby';
import { maven } from './managers/maven';
import { gradle } from './managers/gradle';
import { zig } from './managers/zig';
import { shell } from './managers/shell';

/**
 * Single source of truth for every package manager.
 * `Record<InstallStepType, …>` forces an entry per type — add a type and TS
 * won't compile until you register it here.
 */
export const MANAGERS: Record<InstallStepType, PackageManager> = {
  apt, npm, pip, cargo, go, ruby, maven, gradle, zig, shell,
};

export type { PackageManager, PackageSearchResult };
export { RegistryError } from './RegistryError';

/** Split a raw query like `express@4.17` / `numpy==1.0` into name + version, then search. */
export const searchRegistry = async (rawQuery: string, type: InstallStepType): Promise<PackageSearchResult[]> => {
  const sanitizedQuery = rawQuery.trim().toLowerCase();
  if (!sanitizedQuery) return [];

  const versionMatch = sanitizedQuery.match(/^(.*?)(?:@|==)(.+)$/);
  const searchName = versionMatch ? versionMatch[1] : sanitizedQuery;
  const searchVersion = versionMatch ? versionMatch[2] : null;

  // Let RegistryError bubble to the UI (toast / red boundary).
  return MANAGERS[type].search(searchName, searchVersion);
};

/** File-input `accept` hint for the manager, or `*` if it takes no manifest file. */
export const acceptExtsFor = (type: InstallStepType): string => MANAGERS[type].acceptExts ?? '*';

/** Parse an uploaded manifest file into a dependency list. */
export const parseFile = async (file: File, type: InstallStepType): Promise<string[]> => {
  const manager = MANAGERS[type];
  if (!manager.parse || (manager.canParse && !manager.canParse(file))) {
    throw new Error(`No parser available for ${file.name} under ${type}.`);
  }
  return manager.parse(file);
};
