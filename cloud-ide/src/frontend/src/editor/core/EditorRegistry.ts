// frontend/src/editor/core/EditorRegistry.ts
import * as monaco from 'monaco-editor';
import { EditorEventBus } from './EditorEventBus';

/**
 * The core contract for any language utility.
 * Can be used for Autocompletion (LSP), Hover Tooltips, Formatters, or Syntax Linting.
 */
export interface ILanguageExtension {
  /** The specific language this applies to (e.g., 'python', 'rust', 'javascript') */
  languageId: string;
  
  /** Unique name for debugging (e.g., 'PythonLSPConnector') */
  name: string;

  /** 
   * Called when the editor mounts. 
   * Receives the EventBus so it can route requests to the remote sandbox.
   * @returns A disposable (or array of disposables) to clean up when the editor unmounts.
   */
  install(eventBus: EditorEventBus): monaco.IDisposable[];
}

/**
 * The Central Registry.
 * Holds all language configurations and capabilities before the editor even boots.
 */
export class LanguageRegistry {
  private extensions: Map<string, ILanguageExtension[]> = new Map();

  /** Registers a new extension into the ecosystem */
  public register(extension: ILanguageExtension) {
    if (!this.extensions.has(extension.languageId)) {
      this.extensions.set(extension.languageId, []);
    }
    this.extensions.get(extension.languageId)!.push(extension);
  }

  /** Retrieves all extensions, regardless of language */
  public getAllExtensions(): ILanguageExtension[] {
    return Array.from(this.extensions.values()).flat();
  }

  /** Retrieves extensions ONLY for a specific language (useful for lazy loading) */
  public getExtensionsForLang(languageId: string): ILanguageExtension[] {
    return this.extensions.get(languageId) || [];
  }
}