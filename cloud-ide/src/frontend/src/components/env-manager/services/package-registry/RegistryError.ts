// src/components/env-manager/services/package-registry/RegistryError.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';

export class RegistryError extends Error {
  public registry: InstallStepType;
  public status?: number;

  constructor(message: string, registry: InstallStepType, status?: number) {
    super(message);
    this.name = 'RegistryError';
    this.registry = registry;
    this.status = status;
    
    // Set the prototype explicitly (needed in TS when extending built-ins)
    Object.setPrototypeOf(this, RegistryError.prototype);
  }
}