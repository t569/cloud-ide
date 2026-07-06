/* shared/index.ts
* Barrel file for global imports to other parts
*/
// Explicitly export the classes so the compiler doesn't lose them

// UTILS
export { Validator } from './utils/Validator';
export { optimizeLayers, injectCacheBuster } from './utils/optimise';
export { StepHasher } from './utils/hasher';
export { PackageManagerRules } from './utils/packagemanager_rules';
export {
  isValidId,
  isValidImageRef,
  validateName,
  slugify,
  toImageName,
  generateId,
  generateFriendlyName,
  resolveNewNaming,
  NAME_MAX,
  LABEL_MAX,
} from './utils/naming';
export type { NameCheck, ResolvedNaming } from './utils/naming';

// TYPES
export type {
  ISandboxProvider,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxRecord,
  SandboxSpec,
  SandboxState,
  SandboxStatus,
  VolumeMount,
  VolumeMountKind,
  NetworkPolicySpec,
} from './types/sandbox';

export type { SessionRecord, SessionState } from './types/session';
export type { EnvironmentConfig, BuildStep, InstallStepType } from './types/env';
export type { DeveloperTool, EcosystemToolkit } from './types/ecosystem';
export type { IFileWatcher } from './types/sync';