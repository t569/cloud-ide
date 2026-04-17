// shared/src/utils/iconResolver.ts
import { FILE_NAME_MAP, EXTENSION_MAP } from '../types/constants/iconRegistry';

export interface ResolvedIcon {
  icon: string;
  color?: string; // Optional hex code for monochrome overrides
}

export const resolveIconDefinition = (fileName: string): ResolvedIcon => {
  const name = fileName.toLowerCase();

  // 1. Exact matches (Highest Priority - e.g., 'package.json')
  if (FILE_NAME_MAP[name]) return FILE_NAME_MAP[name];
  
  // 2. Compound Extension Matches (e.g., 'pkg.tar.zst' or 'tar.gz')
  // We split the name into parts. If there's at least one dot, we check combinations.
  const parts = name.split('.');
  
  if (parts.length > 1) {
    // Loop through the parts, starting from the first dot
    // For "app.tar.gz", it checks "tar.gz", then "gz"
    for (let i = 1; i < parts.length; i++) {
      const compoundExt = parts.slice(i).join('.');
      
      if (EXTENSION_MAP[compoundExt]) {
        return EXTENSION_MAP[compoundExt];
      }
    }
  }

  // 3. Dynamic Fallback
  // If we get here, it means no explicit mapping was found. 
  // We grab just the very last extension for the VS Code fallback.
  const finalExt = parts.pop() || '';
  return { icon: `vscode-icons:file-type-${finalExt}` };
};