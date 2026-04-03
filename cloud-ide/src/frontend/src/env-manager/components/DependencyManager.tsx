// src/components/env-manager/DependencyManager.tsx

// To manage the list of dependencies for a build step, 
// allowing users to add/remove packages and import from files. 
// It integrates the PackageSearchWidget for searching and adding packages, 
// and displays them as removable badges. 
// This component is designed to be flexible for different package managers
//  (npm, pip, etc.) based on the stepType prop.


// src/components/env-manager/components/DependencyManager.tsx
import React, { useRef } from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';

import { PackageSearchWidget } from './widgets/PackageSearchWidget';
import { PackageIcon } from 'lucide-react';
import { VscFileCode, VscClose } from 'react-icons/vsc';

// Import our new brains
import { useDependencyParser } from '../hooks/useDependencyParser';
import { useDependencyList } from '../hooks/useDependencyList';

interface DependencyManagerProps {
  stepType: InstallStepType;
  packages: string[];
  onChange: (newPackages: string[]) => void;
}

export const DependencyManager = ({ stepType, packages, onChange }: DependencyManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initialize our hooks
  const { handleAdd, handleRemove, handleBulkAdd } = useDependencyList(stepType, packages, onChange);
  const { parseFile, isParsing, parseError, acceptedExtensions, setParseError } = useDependencyParser(stepType);

  // 2. Minimal UI Event Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const importedPkgs = await parseFile(file);
      handleBulkAdd(importedPkgs);
    } catch (error) {
      // The hook manages the error string, so we don't strictly need an alert here anymore unless you want a toast!
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 3. Pure JSX Return
  return (
    <div className="flex flex-col gap-3 font-sans">
      
      {/* Input Row */}
      <div className="flex gap-2 items-stretch h-10">
        <div className="flex-1">
          <PackageSearchWidget 
            fixedType={stepType} 
            hideHeader={true} 
            onSelect={handleAdd} 
          />
        </div>

        {/* File Import Button */}
        <button 
          type="button" 
          onClick={() => {
            setParseError(null); // Clear old errors when clicking
            fileInputRef.current?.click();
          }}
          disabled={isParsing}
          className="px-3 bg-vscode-tab hover:bg-[#3c3f41] border border-vscode-border rounded text-vscode-textDim flex items-center gap-2 transition disabled:opacity-50"
          title={`Import ${stepType === 'npm' ? 'package.json' : stepType === 'pip' ? 'requirements.txt' : 'dependencies file'}`}
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

      {/* Error State for File Upload */}
      {parseError && (
        <span className="text-red-400 text-xs px-1">{parseError}</span>
      )}

      {/* Removable Badges Area */}
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