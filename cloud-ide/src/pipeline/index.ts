// Public surface of the Dockerfile-generation pipeline.
// Consumed via the `@cloud-ide/pipeline` workspace alias (mirrors @cloud-ide/shared).
export { StageOrchestrator } from './StageOrchestrator';
export { MiddlewareEngine } from './middleware/MiddlewareEngine';
export { SecurityUserInjector } from './middleware/injectors/SecurityUserInjector';
export { LspInjector } from './middleware/injectors/LspInjector';
export { DockerfileAssembler } from './assembler/DockerfileAssembler';
