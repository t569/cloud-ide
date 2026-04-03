// src/components/env-manager/PackageSearchWidget.tsx

// Search a registry for packages
import { useState, useEffect } from 'react';
import { searchRegistry, PackageSearchResult } from '../services/packageApi';
import { InstallStepType } from '@cloud-ide/shared/types/env';

import { RegistryIcon } from '../icons/RegistryIcon';
import { PackageIcon } from '../icons/PackageIcon';

interface PackageSearchWidgetProps {
  fixedType?: InstallStepType; // Locks the registry if passed from a parent
  onSelect?: (pkgName: string, version?: string) => void; // Overrides the default copy-to-clipboard behavior
  hideHeader?: boolean; // Cleans up the UI for inline embedding
}

export const PackageSearchWidget = ({ fixedType, onSelect, hideHeader }: PackageSearchWidgetProps) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<InstallStepType>(fixedType || 'npm');
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  
  // Sync type if the parent changes the fixedType (e.g., changing dropdown in BuildStepCard)
  useEffect(() => {
    if (fixedType) {
      setType(fixedType);
      setQuery(''); // Clear search when registry changes
      setResults([]);
    }
  }, [fixedType]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (query.length > 1) {
        setIsSearching(true);
        const data = await searchRegistry(query, type);
        setResults(data);
        setIsSearching(false);
        setIsOpen(true);
      } else {
        setResults([]);
        setIsOpen(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query, type]);

  const handleAction = (pkgName: string, version?: string) => {
    if (onSelect) {
      // Inline Mode: Pass the selection back to the DependencyManager
      onSelect(pkgName, version);
    } else {
      // Standalone Mode: Copy to clipboard
      const textToCopy = version && query.includes('@') ? `${pkgName}@${version}` 
                       : version && query.includes('==') ? `${pkgName}==${version}`
                       : pkgName;
      navigator.clipboard.writeText(textToCopy);
    }
    
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className={`relative z-10 font-sans ${!hideHeader ? 'mb-6 p-4 bg-[#252526] border border-vscode-border rounded-lg shadow-sm' : ''}`}>
      {!hideHeader && <h3 className="text-sm font-semibold text-gray-200 mb-3">Registry Explorer</h3>}
      
      <div className={`flex items-center bg-vscode-bg border border-vscode-border rounded transition focus-within:border-vscode-accent ${hideHeader ? 'h-full' : ''}`}>
        
        {/* Registry Icon Context */}
        <div className={`flex items-center pl-3 ${fixedType ? 'pr-3 border-r border-vscode-border opacity-80' : 'pr-1'}`}>
          <RegistryIcon type={type} size={18} />
          
          {/* Only show the dropdown if it's NOT fixed by a parent */}
          {!fixedType && (
            <select 
              value={type}
              onChange={(e) => {
                setType(e.target.value as InstallStepType);
                setQuery('');
              }}
              className="bg-transparent text-vscode-accent font-bold font-jetbrains text-sm p-2 outline-none appearance-none cursor-pointer"
            >
              <option value="npm" className="bg-vscode-bg text-gray-200">NPM (npmjs.com)</option>
              <option value="pip" className="bg-vscode-bg text-gray-200">PyPI (pypi.org)</option>
              <option value="cargo" className="bg-vscode-bg text-gray-200">Cargo (crates.io)</option>
              <option value="apt" className="bg-vscode-bg text-gray-200">APT Cache</option>
              <option value="go" className="bg-vscode-bg text-gray-200">Go Modules</option>
              <option value="ruby" className="bg-vscode-bg text-gray-200">RubyGems</option>
              <option value="maven" className="bg-vscode-bg text-gray-200">Maven Central</option>
              <option value="zig" className="bg-vscode-bg text-gray-200">Zig Build</option>
              <option value="shell" className="bg-vscode-bg text-gray-200">Shell Cmd</option>
            </select>
          )}
        </div>

        {/* Search Input */}
        <div className="flex-1 relative">
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Allow "Enter" key for manual comma-separated additions if passed down
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onSelect && query) {
                e.preventDefault();
                onSelect(query);
                setQuery('');
                setIsOpen(false);
              }
            }}
            placeholder={`Search ${type}... (or comma-separated)`} 
            className="w-full p-2 pl-3 bg-transparent text-gray-200 font-jetbrains text-sm outline-none placeholder-vscode-textDim/50"
          />
          {isSearching && (
            <span className="absolute right-3 top-2.5 text-xs text-vscode-accent font-jetbrains animate-pulse">
              fetching...
            </span>
          )}
        </div>
      </div>

      {/* Floating Results Panel */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#252526] border border-vscode-border rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4b4d4f]">
            {results.map((pkg, idx) => (
              <div 
                key={`${pkg.name}-${idx}`}
                onClick={() => handleAction(pkg.name, pkg.version)}
                className="flex items-start gap-3 p-3 border-b border-vscode-border hover:bg-[#2d2d2d] cursor-pointer transition group"
              >
                <div className="pt-1 flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  <PackageIcon name={pkg.name} type={pkg.type} size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-bold text-[#4EC9B0] font-jetbrains truncate">
                      {pkg.name}
                    </span>
                    {pkg.version && (
                      <span className={`text-[10px] font-jetbrains ml-2 border px-1.5 rounded bg-vscode-bg ${pkg.exactMatch ? 'border-green-600 text-green-400' : 'border-vscode-border text-gray-400'}`}>
                        v{pkg.version}
                      </span>
                    )}
                  </div>
                  {pkg.description && (
                    <p className="text-xs text-[#cccccc] truncate font-sans">
                      {pkg.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};