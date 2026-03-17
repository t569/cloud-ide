/*      shared/types/builder.ts
*
* The shared types for building our images
* used by frontend for semantic analysis
* used by backend for parsing to generate dockerfile
*
*/

// this is for global installs (tools we need globally)
export interface PackageDef {
 name: string;
  version?: string; // Defaults to 'latest' if omitted by the user
}

// these are for virtal environments and local-to-repository tool installs
export interface VirtualEnvDef {
  name: string; // e.g., 'api-workspace'
  targetPath: string; // MUST be an absolute path, e.g., '/workspace/api'
  version?: string; // e.g., '18'. Used if the project needs a different runtime than the base image
  libraries: PackageDef[]; // Dependencies isolated to this specific folder
}


// this is the language where we install particular libraries
export interface LanguageSection {
  // Global tools installed via the language's package manager (e.g., npm -g typescript)
  hybridGlobalLibraries: PackageDef[]; 
  
  // Isolated project directories
  virtualEnvironments: VirtualEnvDef[]; 
}


// This is the final type we parse to generate our build image
export interface IDEEnvironmentConfig {
  baseImage: string; // e.g., 'node:18-bullseye'
  
  // OS-level tools installed via apt-get, apk, etc.
  system?: PackageDef[]; 
  
  // Dynamic map of language stacks
  languages?: Record<string, LanguageSection>; 
}