// src/backend/src/services/builder/index.ts

// builder services

// Build backend (swappable via IBuilder / BuilderRegistry)
export type { IBuilder, BuildProcess } from './IBuilder';
export { DockerBuilder } from './DockerBuilder';
export { BuilderRegistry } from './BuilderRegistry';
export { BuildService } from './BuildService';
export { InMemoryBuildStore, JsonBuildStore, BuildConflictError } from './BuildTracker';
export type { IBuildStore, BuildState, BuildStatus } from './BuildTracker';

export { DockerGeneratorService } from './GeneratorService';
export { GarbageCollector } from './GarbageCollector';
export { RegistryService } from './RegistryService';
