// src/components/env-manager/hooks/useDependencyList.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';

export const useDependencyList = (
  stepType: InstallStepType, 
  packages: string[], 
  onChange: (newPackages: string[]) => void
) => {

  const handleAdd = (pkgString: string, version?: string) => {
    let newPkgs: string[] = [];
    
    if (version) {
       const formatted = stepType === 'pip' ? `${pkgString}==${version}` : `${pkgString}@${version}`;
       newPkgs = [formatted];
    } else {
       newPkgs = pkgString.split(',').map(p => p.trim()).filter(Boolean);
    }

    const updatedList = Array.from(new Set([...packages, ...newPkgs]));
    onChange(updatedList);
  };

  const handleRemove = (pkgToRemove: string) => {
    onChange(packages.filter(p => p !== pkgToRemove));
  };

  const handleBulkAdd = (newPackages: string[]) => {
    const updatedList = Array.from(new Set([...packages, ...newPackages]));
    onChange(updatedList);
  };

  return { handleAdd, handleRemove, handleBulkAdd };
};