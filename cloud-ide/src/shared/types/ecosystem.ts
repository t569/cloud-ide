// shared/types/ecosystem.ts

import { InstallStepType } from "./env";

export interface DeveloperTool {
    name: string;
    description: string;
    installStep: {
        type: InstallStepType;
        packages: string[];
        isGlobal: boolean; // For tools that are typically installed globally (e.g., npm, pip)
    };
}


export interface EcosystemToolkit {
    type: InstallStepType;
    language: string;
    recommendedBaseImages: string[]; // Base images that are commonly used for this ecosystem
    languageServers: DeveloperTool[]; // Language servers that can be installed for this ecosystem
   //  linters: DeveloperTool[]; // Linters that can be installed for this ecosystem
    formatters: DeveloperTool[]; // Code formatters that can be installed for this ecosystem
}

