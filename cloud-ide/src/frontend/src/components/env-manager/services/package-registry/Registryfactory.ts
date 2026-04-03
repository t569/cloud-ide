// src/services/package-registry/RegistryFactory.ts
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { IRegistry } from './IRegistry';

// Import all providers

// -------- CORS Registries --------
import { NpmRegistry } from './providers/CORS/NpmRegistry';
import { PypiRegistry } from './providers/CORS/PypiRegistry';
import { RubyRegistry } from './providers/CORS/RubyRegistry';
import { MavenRegistry } from './providers/CORS/MavenRegistry';
import { GradleRegistry } from './providers/CORS/GradleRegistry';
import { CargoRegistry } from './providers/CORS/CargoRegistry';

// -------- Non-CORS Registries --------
import { AptRegistry } from './providers/NonCORS/AptRegistry';
import { GoRegistry } from './providers/NonCORS/GoRegistry';
import { ZigRegistry } from './providers/NonCORS/ZigRegistry';
import { ShellRegistry } from './providers/NonCORS/ShellRegistry';

// Note: Assuming you moved the previous CargoRegistry into this folder too
 

export class RegistryFactory {
  private static instances: Partial<Record<InstallStepType, IRegistry>> = {};

  static getRegistry(type: InstallStepType): IRegistry {
    if (this.instances[type]) return this.instances[type]!;

    let registry: IRegistry;

    switch (type) {
      case 'npm': registry = new NpmRegistry(); break;
      case 'pip': registry = new PypiRegistry(); break;
      case 'ruby': registry = new RubyRegistry(); break;
      case 'maven': registry = new MavenRegistry(); break;
      case 'gradle': registry = new GradleRegistry(); break;
      case 'cargo': registry = new CargoRegistry(); break;
      case 'go': registry = new GoRegistry(); break;
      case 'apt': registry = new AptRegistry(); break;
      case 'zig': registry = new ZigRegistry(); break;
      case 'shell': registry = new ShellRegistry(); break;
      default: registry = new AptRegistry();
    }

    this.instances[type] = registry;
    return registry;
  }
}