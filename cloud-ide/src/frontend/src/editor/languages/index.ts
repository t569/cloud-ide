// frontend/src/editor/languages/index.ts
// Barrel + THE ONE PLACE YOU INSTALL LANGUAGES (the manifest analog of lsp/).
export * from './types';
export { LanguageRegistry } from './LanguageRegistry';
export { BUILTIN_LANGUAGES } from './builtins';

import { LanguageRegistry } from './LanguageRegistry';
import { BUILTIN_LANGUAGES } from './builtins';

/**
 * Build the registry the editor boots with. Seeds Monaco's built-in languages;
 * add a custom-grammar contribution here (or via a session plugin) to light up
 * a language Monaco doesn't ship.
 */
export function createLanguageRegistry(): LanguageRegistry {
  const reg = new LanguageRegistry();
  reg.register(...BUILTIN_LANGUAGES);
  return reg;
}
