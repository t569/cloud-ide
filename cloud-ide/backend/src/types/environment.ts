// src/types/environments.ts 

// defines the structure for the environments.json file
export interface Package {
  name: string;
  version?: string; 
}

export interface EnvironmentConfig {
  id?: string;
  name: string;
  base: string; // e.g., 'ubuntu:22.04', 'node:18', 'python:3.10'
  packages: {
    system: Package[];
    language: Package[];
  };
}