// The "Select Language Mode" popup behind the status bar's language read-out.
// Overrides what LanguageRegistry.detect() guessed for the active file — the escape
// hatch for an extensionless script, a .txt that is really JSON, or a file whose
// extension lies.
import React, { useEffect, useMemo, useRef, useState } from 'react';

interface LanguagePickerProps {
  languages: Array<{ id: string; label: string }>;
  /** The language currently in effect, so the list can mark it. */
  current: string | null;
  onSelect: (languageId: string) => void;
  onClose: () => void;
}

export const LanguagePicker = ({ languages, current, onSelect, onClose }: LanguagePickerProps) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter((l) => l.label.toLowerCase().includes(q) || l.id.includes(q));
  }, [languages, query]);

  return (
    // Backdrop: a click anywhere else dismisses, matching the command palette.
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-7 right-2 w-72 overflow-hidden rounded-md border border-ide-border bg-ide-panel shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Select language mode"
          spellCheck={false}
          className="w-full border-b border-ide-border bg-ide-bg px-3 py-2 text-[12px] text-ide-text outline-none"
        />
        <ul className="max-h-64 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-ide-muted">No matching language</li>
          ) : (
            matches.map((lang) => (
              <li key={lang.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(lang.id);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-ide-hover ${
                    lang.id === current ? 'text-ide-accent' : 'text-ide-text'
                  }`}
                >
                  <span>{lang.label}</span>
                  {lang.id === current && <span className="text-[10px] text-ide-muted">current</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
