// src/components/env-manager/DependencyManager.tsx

// To manage the list of dependencies for a build step, 
// allowing users to add/remove packages and import from files. 
// It integrates the PackageSearchWidget for searching and adding packages, 
// and displays them as removable badges. 
// This component is designed to be flexible for different package managers
//  (npm, pip, etc.) based on the stepType prop.


import React, { useRef } from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
// import { parseDependencyFile } from './utils/fileParser';

import { PackageSearchWidget } from './widgets/PackageSearchWidget';
import { PackageIcon } from './icons/PackageIcon';
import { VscFileCode, VscClose } from 'react-icons/vsc';

// for parsing uploaded files
import { DependencyParserRegistry } from './utils/parsers/DependecyParserRegistry';

interface DependencyManagerProps {
  stepType: InstallStepType;
  packages: string[];
  onChange: (newPackages: string[]) => void;
}

export const DependencyManager = ({ stepType, packages, onChange }: DependencyManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAdd = (pkgString: string, version?: string) => {
    // If a version string is passed, format it. Otherwise, split by commas for manual entry.
    let newPkgs: string[] = [];
    if (version) {
       // Append version syntax based on registry format
       const formatted = stepType === 'pip' ? `${pkgString}==${version}` : `${pkgString}@${version}`;
       newPkgs = [formatted];
    } else {
       newPkgs = pkgString.split(',').map(p => p.trim()).filter(Boolean);
    }

    const updatedList = Array.from(new Set([...packages, ...newPkgs])); // Deduplicate
    onChange(updatedList);
  };

  const handleRemove = (pkgToRemove: string) => {
    onChange(packages.filter(p => p !== pkgToRemove));
  };

  // TODO: (make more robust) Handle file uploads to import dependencies

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      // We pass the file and the stepType (e.g., 'pip') to our new Registry
      const importedPkgs = await DependencyParserRegistry.parseFile(file, stepType);
      
      // Deduplicate and update state
      const updatedList = Array.from(new Set([...packages, ...importedPkgs]));
      onChange(updatedList);

    } catch (error) {
      // Here you could trigger a toast notification or set an error state
      console.error((error as Error).message);
      alert((error as Error).message); 
    } finally {
      // Reset the file input so the user can upload the same file again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-3 font-sans">
      
      {/* Input Row: Reused Widget + File Upload */}
      <div className="flex gap-2 items-stretch h-10">
        
        <div className="flex-1">
          {/* HERE IS THE MAGIC: We pass the parent stepType to lock the widget! */}
          <PackageSearchWidget 
            fixedType={stepType} 
            hideHeader={true} 
            onSelect={handleAdd} 
          />
        </div>

        {/* File Import Button */}
        <button 
          type="button" 
          onClick={() => fileInputRef.current?.click()}
          className="px-3 bg-vscode-tab hover:bg-[#3c3f41] border border-vscode-border rounded text-vscode-textDim flex items-center gap-2 transition"
          title={`Import ${stepType === 'npm' ? 'package.json' : stepType === 'pip' ? 'requirements.txt' : 'dependencies file'}`}
        >
          <VscFileCode size={16} />
          <span className="text-sm hidden sm:inline">Import</span>
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept={DependencyParserRegistry.getAcceptedExtensions(stepType)}
          onChange={handleFileUpload} 
        />
      </div>

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