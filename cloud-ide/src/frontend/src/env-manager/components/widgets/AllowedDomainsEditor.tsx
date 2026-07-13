// A chip editor for an environment's egress allow-list — the EXTRA domains its sandboxes
// may reach at runtime, on top of the package registries auto-derived from its build steps
// (see backend network/policy.ts). This is the no-code path for "my app calls api.stripe.com".
//
// Controlled (value + onChange), like LanguageServerPicker: the value is a string[], which
// react-hook-form's register() doesn't handle — the parent wires it via setValue().
import React, { useState } from 'react';
import { VscClose, VscAdd } from 'react-icons/vsc';
import { normalizeDomain } from '../../utils/domain';

interface Props {
  domains: string[];
  onChange: (domains: string[]) => void;
}

const inputCls =
  'flex-1 rounded-lg bg-[#1a1a1a] border border-white/[0.07] px-3 py-2.5 text-sm text-gray-100 outline-none transition-all placeholder:text-gray-600 hover:border-white/[0.12] focus:border-[#3574d4] focus:ring-2 focus:ring-[#3574d4]/25';

export const AllowedDomainsEditor = ({ domains, onChange }: Props) => {
  const [draft, setDraft] = useState('');

  const add = () => {
    const d = normalizeDomain(draft); // bare host/wildcard; '' if blank
    if (!d || domains.includes(d)) {  // dedupe silently
      setDraft('');
      return;
    }
    onChange([...domains, d]);
    setDraft('');
  };

  const remove = (d: string) => onChange(domains.filter((x) => x !== d));

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds a chip — NOT submit the whole env form (this lives inside one).
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="api.example.com  or  *.example.com"
          className={inputCls}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 px-3.5 rounded-lg border border-white/[0.08] bg-[#1a1a1a] text-sm text-gray-300 hover:border-white/[0.16] hover:text-gray-100"
        >
          <VscAdd className="text-[13px]" /> Add
        </button>
      </div>

      {domains.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {domains.map((d) => (
            <span
              key={d}
              className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-[#1a1a1a] border border-white/[0.08] text-[12.5px] text-gray-200 font-jetbrains"
            >
              {d}
              <button
                type="button"
                onClick={() => remove(d)}
                aria-label={`Remove ${d}`}
                className="grid place-items-center w-4 h-4 rounded text-gray-500 hover:text-gray-100 hover:bg-white/[0.08]"
              >
                <VscClose className="text-[12px]" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
