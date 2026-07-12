// src/env-manager/components/widgets/LanguageServerPicker.tsx
//
// Picks the language servers baked into the image. The options come from the SAME
// table the pipeline installs from and the backend spawns from
// (shared/languageServers.ts), so this list can never offer a server that doesn't
// actually exist — add a row there and it shows up here.
import React from 'react';
// Subpath, not the barrel: the barrel pulls in the Validator and the build-pipeline
// helpers, none of which belong in the browser bundle.
import { SUPPORTED_LANGUAGE_SERVERS } from '@cloud-ide/shared/languageServers';

// Label only — the value is the editor's language id, which is what the whole chain keys on.
const LABELS: Record<string, string> = {
  python: 'Python',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  rust: 'Rust',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
  shell: 'Shell',
};

interface Props {
  selected: string[];
  onChange: (languages: string[]) => void;
}

export const LanguageServerPicker = ({ selected, onChange }: Props) => {
  const toggle = (lang: string) =>
    onChange(selected.includes(lang) ? selected.filter((l) => l !== lang) : [...selected, lang]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_LANGUAGE_SERVERS.map((lang) => {
          const on = selected.includes(lang);
          return (
            <button
              key={lang}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(lang)}
              className={`px-3 py-1.5 rounded-lg text-[13px] border transition-all ${
                on
                  ? 'border-[#3574d4] bg-[#3574d4]/15 text-[#8ab4f8]'
                  : 'border-white/[0.07] bg-[#1a1a1a] text-gray-400 hover:border-white/[0.15] hover:text-gray-200'
              }`}
            >
              {LABELS[lang] ?? lang}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600">
        Installed into the image and run inside the sandbox, so they resolve your actual
        dependencies. The base image must already have the toolchain each one needs
        (<span className="font-jetbrains">pip</span>, <span className="font-jetbrains">npm</span>,{' '}
        <span className="font-jetbrains">rustup</span>, <span className="font-jetbrains">go</span>,{' '}
        <span className="font-jetbrains">apt</span>) or the build fails.
      </p>
    </div>
  );
};
