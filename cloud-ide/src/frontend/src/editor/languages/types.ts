// frontend/src/editor/languages/types.ts
//
// THE PORT for syntax highlighting — the analog of `lsp/types.ts`.
// "Installing language support" = registering a LanguageContribution.
//
// monaco is imported as a *type only* (erased at runtime) so this file — and
// everything that only needs the interface (detection, the status bar) — stays
// free of a runtime monaco dependency and unit-testable without a DOM.
import type * as monaco from 'monaco-editor';

/** A custom Monarch grammar + optional language configuration. */
export interface LanguageGrammar {
  tokenizer: monaco.languages.IMonarchLanguage;
  configuration?: monaco.languages.LanguageConfiguration;
}

/**
 * One installable language. Detection (extensions/filenames) is always used;
 * the highlighter is Monaco's built-in Monarch grammar UNLESS `grammar` is
 * supplied — that's the seam for languages Monaco doesn't ship (and, later, for
 * plugin-contributed grammars: TextMate, tree-sitter, a neovim adapter, …).
 */
export interface LanguageContribution {
  /** Monaco language id, e.g. 'python'. */
  id: string;
  /** Display name for the status bar, e.g. 'Python'. */
  label: string;
  /** Leading-dot extensions, e.g. ['.py', '.pyw']. */
  extensions?: string[];
  /** Exact base names with no extension, e.g. ['Dockerfile', 'Makefile']. */
  filenames?: string[];
  /**
   * Omit → Monaco already tokenizes `id`, nothing to install.
   * Provide → a custom grammar, registered on install(). A thunk so a large
   * grammar is code-split and only fetched when that language is actually used.
   */
  grammar?: () => Promise<LanguageGrammar>;
}
