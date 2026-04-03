// src/utils/parsers/IFileParser.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';

export interface IFileParser {
  /**
   * The package manager this parser belongs to.
   */
  type: InstallStepType;

  /**
   * Determines if this parser can handle the uploaded file.
   */
  canParse(file: File): boolean;

  /**
   * Reads the file and extracts a list of dependencies.
   */
  parse(file: File): Promise<string[]>;
}