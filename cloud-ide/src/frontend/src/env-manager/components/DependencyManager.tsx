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
import { VscFileCode, VscClose, VscTrash } from 'react-icons/vsc';
import { useDependencyActions } from '../hooks/useDependencyActions';
import { toast } from '@frontend/notifications';

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

  const handleClearAll = () => {
    const count = packages.length;
    onChange([]);
    toast.warning(`Removed ${count} ${count === 1 ? 'package' : 'packages'} from this step`, {
      title: 'Cleared',
    });
  };

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
          className="px-3.5 bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] rounded-lg text-gray-300 flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          <VscFileCode size={16} className={isParsing ? 'animate-pulse' : ''} />
          <span className="text-sm hidden sm:inline font-medium">
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
        <span className="text-red-400 text-xs px-1 animate-fade-in">{parseError}</span>
      )}

      {packages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-medium text-gray-500">
              {packages.length} {packages.length === 1 ? 'package' : 'packages'}
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-red-400 rounded px-1.5 py-0.5 hover:bg-red-400/10 transition-colors"
            >
              <VscTrash size={12} />
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2 p-2.5 bg-black/25 border border-white/[0.05] rounded-lg min-h-[40px]">
            {packages.map((pkg, i) => (
            <div
              key={`${pkg}-${i}`}
              className="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.08] hover:border-[#3574d4]/60 rounded-md pl-2 pr-1.5 py-1 text-xs text-gray-200 shadow-sm transition-colors animate-fade-in"
            >
              <PackageIcon name={pkg} type={stepType} size={12} />
              <span className="font-jetbrains text-[11px] mt-0.5">{pkg}</span>
              <button
                type="button"
                onClick={() => handleRemove(pkg)}
                aria-label={`Remove ${pkg}`}
                className="ml-0.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded p-0.5 focus:outline-none transition-colors"
              >
                <VscClose size={13} />
              </button>
            </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};