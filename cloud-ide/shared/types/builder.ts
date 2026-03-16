// shared/types/builder.ts

// The shared types for building our images
// used by frontend for semantic analysis
// used by backend for parsing to generate dockerfile

export type InstallScope = 'global' | 'local';

// this is a package definition aswell as install location and install options e.g. Local or Global
export interface PackageDef {
  name: string;
  version?: string; // Defaults to 'latest' if omitted
  scope?: InstallScope; // e.g., global vs local 
  targetPath?: string; // Required if scope is 'local' (e.g., /workspace/node_modules) 
}

// this is the language where we install particular libraries
export interface LanguageSection {
  libraries: PackageDef[]; // Libraries specific to a language [cite: 7]
}


// NOTE: add a language here if you want it to register in our build options

// This is the final type we parse to generate our build image
export interface IDEEnvironmentConfig {
  baseImage: string; // e.g., 'ubuntu:22.04', 'node:18-bullseye' [cite: 7]
  system: PackageDef[]; // List of system tools to install via apt/apk [cite: 7]
  languages: {
    python?: LanguageSection; // Python specific section [cite: 7]
    node?: LanguageSection;
    cpp?: LanguageSection; 
    rust?: LanguageSection;
    go?: LanguageSection;

  };
}