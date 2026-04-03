// src/components/env-manager/hooks/useDependencyActions.ts
import { useRef } from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { useDependencyList } from './useDependencyList';
import { useDependencyParser } from './useDependencyParser';

export const useDependencyActions = (
  stepType: InstallStepType,
  packages: string[],
  onChange: (newPackages: string[]) => void
) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Initialize our underlying brains
  const list = useDependencyList(stepType, packages, onChange);
  const parser = useDependencyParser(stepType);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const importedPkgs = await parser.parseFile(file);
      list.handleBulkAdd(importedPkgs);
    } catch (error) {
      // Logic for errors is already handled inside useDependencyParser
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const triggerFileUpload = () => {
    parser.setParseError(null);
    fileInputRef.current?.click();
  };

  return {
    ...list,
    ...parser,
    fileInputRef,
    handleFileUpload,
    triggerFileUpload
  };
};