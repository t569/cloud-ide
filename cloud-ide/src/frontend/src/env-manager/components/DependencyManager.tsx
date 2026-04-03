// src/components/env-manager/DependencyManager.tsx

// To manage the list of dependencies for a build step, 
// allowing users to add/remove packages and import from files. 
// It integrates the PackageSearchWidget for searching and adding packages, 
// and displays them as removable badges. 
// This component is designed to be flexible for different package managers
//  (npm, pip, etc.) based on the stepType prop.

// src/components/env-manager/components/DependencyManager.tsx
import React from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { PackageSearchWidget } from './widgets/PackageSearchWidget';
import { PackageIcon } from './icons/PackageIcon'; // Assuming your custom icon component
import { VscFileCode, VscClose } from 'react-icons/vsc';
import { useDependencyActions } from '../hooks/useDependencyActions';

interface DependencyManagerProps {
  stepType: InstallStepType;
  packages: string[];
  onChange: (newPackages: string[]) => void;
}

export const DependencyManager = ({ stepType, packages, onChange }: DependencyManagerProps) => {
  // All logic, refs, and state are handled here
  const { 
    handleAdd, 
    handleRemove, 
    handleFileUpload, 
    triggerFileUpload,
    fileInputRef,
    isParsing,
    parseError,
    acceptedExtensions 
  } = useDependencyActions(stepType, packages, onChange);

  return (
    <div className="flex flex-col gap-3 font-sans">
      <div className="flex gap-2 items-stretch h-10">
        <div className="flex-1">
          <PackageSearchWidget 
            fixedType={stepType} 
            hideHeader={true} 
            onSelect={handleAdd} 
          />
        </div>

        <button 
          type="button" 
          onClick={triggerFileUpload}
          disabled={isParsing}
          className="px-3 bg-vscode-tab hover:bg-[#3c3f41] border border-vscode-border rounded text-vscode-textDim flex items-center gap-2 transition disabled:opacity-50"
        >
          <VscFileCode size={16} />
          <span className="text-sm hidden sm:inline">
            {isParsing ? 'Parsing...' : 'Import'}
          </span>
        </button>
        
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept={acceptedExtensions}
          onChange={handleFileUpload} 
        />
      </div>

      {parseError && (
        <span className="text-red-400 text-xs px-1">{parseError}</span>
      )}

      {packages.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-[#1e1e1e]/50 border border-vscode-border rounded-md min-h-[40px]">
          {packages.map((pkg, i) => (
            <div 
              key={`${pkg}-${i}`} 
              className="flex items-center gap-1.5 bg-[#2d2d2d] border border-vscode-border hover:border-vscode-accent/50 rounded px-2 py-1 text-xs text-gray-300 shadow-sm transition-colors group"
            >
              <PackageIcon name={pkg} type={stepType} size={12} />
              <span className="font-jetbrains text-[11px] mt-0.5">{pkg}</span>
              <button 
                type="button" 
                onClick={() => handleRemove(pkg)}
                className="ml-1 text-gray-500 hover:text-red-400 focus:outline-none transition-colors"
              >
                <VscClose size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};