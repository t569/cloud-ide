// frontend/src/editor/plugins/PluginManifest.ts

import { ILanguageExtension } from '../core/EditorRegistry';
import { PythonLSPConnector } from './PythonLSPConnector';
// import { RustLSPConnector } from './RustLSPConnector';
// import { ZigLSPConnector } from './ZigLSPConnector';

// We export an array of classes (not instances)
export const AVAILABLE_PLUGINS: (new () => ILanguageExtension)[] = [
  PythonLSPConnector,
  // RustLSPConnector,
  // ZigLSPConnector
];