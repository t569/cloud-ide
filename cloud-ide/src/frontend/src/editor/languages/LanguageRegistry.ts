// frontend/src/editor/languages/LanguageRegistry.ts
//
// Holds the installed language contributions and answers the two questions the
// editor asks: "what language is this file?" (detect) and "what do I call it?"
// (displayName). On editor mount it installs any custom Monarch grammars.
//
// The analog of `lsp/LanguageServiceRegistry`. monaco is a *type-only* import —
// the real monaco arrives as the `m` argument to install(), so this whole class
// (detection included) runs without a runtime monaco dependency.
import type * as monaco from 'monaco-editor';
import { LanguageContribution } from './types';

const PLAINTEXT = 'plaintext';

export class LanguageRegistry {
  private contributions: LanguageContribution[] = [];
  private labels = new Map<string, string>([[PLAINTEXT, 'Plain Text']]);

  /** Install one or more languages. Later registrations win on conflict. */
  register(...contribs: LanguageContribution[]): void {
    for (const c of contribs) {
      this.contributions.unshift(c); // searched first → overrides earlier entries
      this.labels.set(c.id, c.label);
    }
  }

  /**
   * Resolve a file path to a language id. Exact filename wins over extension;
   * unknown files are 'plaintext' (Monaco's safe default). Content-based
   * detection (shebangs) is a future add — hang it off here, callers won't change.
   */
  detect(path: string): string {
    const name = (path.split('/').pop() ?? '').toLowerCase();
    for (const c of this.contributions) {
      if (c.filenames?.some((f) => f.toLowerCase() === name)) return c.id;
    }
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : ''; // dot>0 so a dotfile isn't "all extension"
    if (ext) {
      for (const c of this.contributions) {
        if (c.extensions?.some((e) => e.toLowerCase() === ext)) return c.id;
      }
    }
    return PLAINTEXT;
  }

  /** Human-readable name for the status bar. Falls back to the raw id. */
  displayName(languageId: string): string {
    return this.labels.get(languageId) ?? languageId;
  }

  /**
   * Every installed language, alphabetically — what the status bar's language picker
   * offers. Includes 'plaintext', which is the point: it's how you tell the editor to
   * stop syntax-highlighting a file it guessed wrong about.
   */
  list(): Array<{ id: string; label: string }> {
    return Array.from(this.labels, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  /**
   * Register every custom grammar with Monaco. Built-ins (no `grammar`) are
   * already tokenized by Monaco, so this is a no-op for them. Call ONCE on
   * editor mount; dispose the returned handles on unmount.
   */
  install(m: typeof monaco): monaco.IDisposable[] {
    const disposables: monaco.IDisposable[] = [];
    for (const c of this.contributions) {
      if (!c.grammar) continue; // Monaco's built-in grammar handles it
      m.languages.register({
        id: c.id,
        extensions: c.extensions,
        filenames: c.filenames,
        aliases: [c.label],
      });
      // The grammar is loaded lazily; return a disposable now that tears down
      // whatever the async load registers, so unmount is correct either way.
      const handles: monaco.IDisposable[] = [];
      c.grammar()
        .then(({ tokenizer, configuration }) => {
          handles.push(m.languages.setMonarchTokensProvider(c.id, tokenizer));
          if (configuration) handles.push(m.languages.setLanguageConfiguration(c.id, configuration));
        })
        .catch((err) => console.warn(`[languages] grammar for ${c.id} failed to load:`, err));
      disposables.push({ dispose: () => handles.forEach((h) => h.dispose()) });
    }
    return disposables;
  }
}
