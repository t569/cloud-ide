// src/components/env-manager/hooks/usePackageSearchWidget.ts
import { useState, useEffect, useCallback } from 'react';
import { searchRegistry } from '../services/package-registry';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { PackageSearchResult } from '../services/package-registry';
interface UsePackageSearchWidgetProps {
  fixedType?: InstallStepType;
  onSelect?: (pkgName: string, version?: string) => void;
}

export const usePackageSearchWidget = ({ fixedType, onSelect }: UsePackageSearchWidgetProps) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<InstallStepType>(fixedType || 'npm');
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync type if the parent changes the fixedType
  useEffect(() => {
    if (fixedType) {
      setType(fixedType);
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [fixedType]);

  // The Search Effect (Debounced)
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (query.length > 1) {
        setIsSearching(true);
        setError(null);
        
        try {
          const data = await searchRegistry(query, type);
          setResults(data);
          setIsOpen(true);
        } catch (err: any) {
          setResults([]);
          setIsOpen(false);
          setError(err.name === 'RegistryError' ? err.message : 'Registry search failed.');
        } finally {
          setIsSearching(false);
        }
      } else {
        setResults([]);
        setIsOpen(false);
        setError(null);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query, type]);

  const handleAction = useCallback((pkgName: string, version?: string) => {
    if (onSelect) {
      onSelect(pkgName, version);
    } else {
      const textToCopy = version && query.includes('@') ? `${pkgName}@${version}` 
                       : version && query.includes('==') ? `${pkgName}==${version}`
                       : pkgName;
      navigator.clipboard.writeText(textToCopy);
    }
    
    setIsOpen(false);
    setQuery('');
  }, [onSelect, query]);

  return {
    query,
    setQuery,
    type,
    setType,
    results,
    isSearching,
    isOpen,
    setIsOpen,
    error,
    setError,
    handleAction
  };
};