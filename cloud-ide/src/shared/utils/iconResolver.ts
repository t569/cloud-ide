// shared/src/utils/iconResolver.ts
import { FILE_NAME_MAP, EXTENSION_MAP } from '../types/constants/iconRegistry';

export interface ResolvedIcon {
  icon: string;
  color?: string; // Optional hex code for monochrome overrides
}

// search our icon db and resolve the file icon image
export const resolveIconDefinition = (fileName: string): ResolvedIcon => {
  const name = fileName.toLowerCase();
  const ext = name.split('.').pop() || '';

  // 1. Exact matches
  if (FILE_NAME_MAP[name]) return FILE_NAME_MAP[name];
  
  // 2. Extension matches
  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  // 3. THE FIX: Fallback to VS Code's colored file icons!
  // This automatically fixes config.nix because 'vscode-icons:file-type-nix' exists and is colored.
  return { icon: `vscode-icons:file-type-${ext}` };
};

