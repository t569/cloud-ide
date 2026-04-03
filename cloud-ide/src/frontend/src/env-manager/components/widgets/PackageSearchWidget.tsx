// src/components/env-manager/widgets/PackageSearchWidget.tsx
import React from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { RegistryIcon } from '../icons/RegistryIcon';
import { PackageIcon } from '../icons/PackageIcon';
import { VscError } from 'react-icons/vsc';
import { usePackageSearchWidget } from '@frontend/env-manager/hooks/usePackageSearchWidget';

interface PackageSearchWidgetProps {
  fixedType?: InstallStepType;
  onSelect?: (pkgName: string, version?: string) => void;
  hideHeader?: boolean;
}

export const PackageSearchWidget = ({ fixedType, onSelect, hideHeader }: PackageSearchWidgetProps) => {
  const {
    query, setQuery,
    type, setType,
    results, isSearching,
    isOpen, setIsOpen,
    error, setError,
    handleAction
  } = usePackageSearchWidget({ fixedType, onSelect });

  return (
    <div className={`relative z-10 font-sans ${!hideHeader ? 'mb-6 p-4 bg-[#252526] border border-vscode-border rounded-lg shadow-sm' : ''}`}>
      {!hideHeader && <h3 className="text-sm font-semibold text-gray-200 mb-3">Registry Explorer</h3>}
      
      <div className={`flex items-center bg-vscode-bg border rounded transition ${error ? 'border-red-500/50' : 'border-vscode-border focus-within:border-vscode-accent'} ${hideHeader ? 'h-full' : ''}`}>
        
        <div className={`flex items-center pl-3 ${fixedType ? 'pr-3 border-r border-vscode-border opacity-80' : 'pr-1'}`}>
          <RegistryIcon type={type} size={18} />
          
          {!fixedType && (
            <select 
              value={type}
              onChange={(e) => setType(e.target.value as InstallStepType)}
              className="bg-transparent text-vscode-accent font-bold font-jetbrains text-sm p-2 outline-none appearance-none cursor-pointer"
            >
              {['npm', 'pip', 'cargo', 'apt', 'go', 'ruby', 'maven', 'gradle', 'zig', 'shell'].map(t => (
                <option key={t} value={t} className="bg-vscode-bg text-gray-200 uppercase">{t}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 relative">
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onSelect && query) {
                e.preventDefault();
                handleAction(query);
              }
            }}
            placeholder={`Search ${type}...`} 
            className="w-full p-2 pl-3 bg-transparent text-gray-200 font-jetbrains text-sm outline-none placeholder-vscode-textDim/50"
          />
          {isSearching && (
            <span className="absolute right-3 top-2.5 text-xs text-vscode-accent font-jetbrains animate-pulse">
              fetching...
            </span>
          )}
        </div>
      </div>

      {/* Error Notification Panel */}
      {error && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#2d0a0a] border border-red-500/30 rounded shadow-2xl z-50 p-3 flex items-start gap-2">
          <VscError className="text-red-400 mt-0.5 flex-shrink-0" size={16} />
          <div>
            <span className="block text-xs font-bold text-red-400 font-jetbrains mb-0.5">Registry Error</span>
            <span className="block text-xs text-red-300/80 font-sans">{error}</span>
          </div>
        </div>
      )}

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