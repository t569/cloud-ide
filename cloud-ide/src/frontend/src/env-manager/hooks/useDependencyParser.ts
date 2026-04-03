// src/components/env-manager/hooks/useDependencyParser.ts
import { useState } from 'react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { DependencyParserRegistry } from '../utils/parsers/DependecyParserRegistry';

export const useDependencyParser = (stepType: InstallStepType) => {
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const parseFile = async (file: File): Promise<string[]> => {
    setIsParsing(true);
    setParseError(null);

    try {
      return await DependencyParserRegistry.parseFile(file, stepType);
    } catch (error) {
      const errorMessage = (error as Error).message;
      setParseError(errorMessage);
      throw error; // Let the caller know it failed
    } finally {
      setIsParsing(false);
    }
  };

  const acceptedExtensions = DependencyParserRegistry.getAcceptedExtensions(stepType);

  return { parseFile, isParsing, parseError, acceptedExtensions, setParseError };
};