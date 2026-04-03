// frontend/src/components/env-manager/utils/fileParser.ts

// This utility function parses uploaded dependency files (like package.json for npm or requirements.txt for pip) 
// and extracts a list of package names.
//  It handles different formats based on the type of environment (npm, pip, etc.) 
// and returns a clean array of package names that can be used for further processing 
// (like searching for versions or displaying in the UI).
import { InstallStepType } from '@cloud-ide/shared/types/env';

export const parseDependencyFile = async (file: File, type: InstallStepType): Promise<string[]> => {
  const text = await file.text();
  let packages: string[] = [];

  try {
    if (type === 'npm' && file.name.endsWith('.json')) {
      // Parse package.json
      const json = JSON.parse(text);
      packages = [
        ...Object.keys(json.dependencies || {}),
        ...Object.keys(json.devDependencies || {})
      ];
    } else if (type === 'pip') {
      // Parse requirements.txt (ignore comments, grab package names/versions)
      packages = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); 
    } else {
      // Generic line-by-line fallback (for apt, cargo, etc.)
      packages = text.split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.error("Failed to parse file:", error);
  }

  // Deduplicate and return
  return Array.from(new Set(packages));
};