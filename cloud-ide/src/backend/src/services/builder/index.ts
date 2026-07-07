// src/backend/src/services/builder/index.ts

// builder services

// Build backend (swappable via IBuilder / BuilderRegistry)
export type { IBuilder, BuildProcess } from './IBuilder';
export { DockerBuilder } from './DockerBuilder';
export { BuilderRegistry } from './BuilderRegistry';
export { BuildService } from './BuildService';
export { InMemoryBuildStore, JsonBuildStore, BuildConflictError } from './BuildStore';
export type { IBuildStore, BuildState, BuildStatus } from './BuildStore';
export { RedisBuildStore } from './RedisBuildStore';
export type { RedisLike } from './RedisBuildStore';
export { createBuildStore } from './createBuildStore';
export type { BuildStoreOptions } from './createBuildStore';

export { DockerGeneratorService } from './GeneratorService';
export { GarbageCollector } from './GarbageCollector';
