// src/components/env-manager/widgets/PackageSearchWidget.tsx
import React from 'react';
import { InstallStepType, INSTALL_STEPS } from '@cloud-ide/shared/types/env';
import { EnvIcon } from '../../registry/EnvIcon';
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
    <div className={`relative z-10 font-sans ${!hideHeader ? 'mb-6 p-4 bg-[#252526] border border-white/[0.06] rounded-xl shadow-sm' : ''}`}>
      {!hideHeader && <h3 className="text-sm font-semibold text-gray-200 mb-3">Registry Explorer</h3>}

      <div className={`flex items-center bg-[#161616] border rounded-lg transition-all ${error ? 'border-red-500/50 ring-2 ring-red-500/15' : 'border-white/[0.08] focus-within:border-[#3574d4] focus-within:ring-2 focus-within:ring-[#3574d4]/25'} ${hideHeader ? 'h-full' : ''}`}>

        <div className={`flex items-center pl-3 ${fixedType ? 'pr-3 border-r border-white/[0.08] opacity-80' : 'pr-1'}`}>
          <EnvIcon type={type} size={18} />
          
          {!fixedType && (
            <select 
              value={type}
              onChange={(e) => setType(e.target.value as InstallStepType)}
              className="bg-transparent text-vscode-accent font-bold font-jetbrains text-sm p-2 outline-none appearance-none cursor-pointer"
            >
              {INSTALL_STEPS.map(t => (
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
            className="w-full p-2 pl-3 bg-transparent text-gray-200 font-jetbrains text-sm outline-none placeholder:text-gray-600"
          />
          {isSearching && (
            <span className="absolute right-3 top-2.5 text-xs text-[#3574d4] font-jetbrains animate-pulse">
              fetching...
            </span>
          )}
        </div>
      </div>

      {/* Error Notification Panel */}
      {error && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#2d0a0a] border border-red-500/30 rounded-lg shadow-2xl z-50 p-3 flex items-start gap-2 animate-fade-up">
          <VscError className="text-red-400 mt-0.5 flex-shrink-0" size={16} />
          <div>
            <span className="block text-xs font-bold text-red-400 font-jetbrains mb-0.5">Registry Error</span>
            <span className="block text-xs text-red-300/80 font-sans">{error}</span>
          </div>
        </div>
      )}

      {/* Floating Results Panel */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#232323] border border-white/[0.08] rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden animate-fade-up">
          <div className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-white/[0.05]">
            {results.map((pkg, idx) => (
              <div
                key={`${pkg.name}-${idx}`}
                onClick={() => handleAction(pkg.name, pkg.version)}
                className="flex items-start gap-3 p-3 hover:bg-white/[0.04] cursor-pointer transition-colors group"
              >
                <div className="pt-0.5 flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  <PackageIcon name={pkg.name} type={pkg.type} size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1 gap-2">
                    <span className="text-sm font-bold text-[#4EC9B0] font-jetbrains truncate">
                      {pkg.name}
                    </span>
                    {pkg.version && (
                      <span className={`text-[10px] font-jetbrains flex-shrink-0 border px-1.5 py-0.5 rounded ${pkg.exactMatch ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-white/[0.1] text-gray-400 bg-black/30'}`}>
                        v{pkg.version}
                      </span>
                    )}
                  </div>
                  {pkg.description && (
                    <p className="text-xs text-gray-400 truncate font-sans">
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