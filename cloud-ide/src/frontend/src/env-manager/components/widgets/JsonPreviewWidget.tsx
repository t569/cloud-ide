// src/frontend/src/components/env-manager/widgets/JsonPreviewWidget.tsx

// Real-time JSON preview of the environment config with copy-to-clipboard.
// Styled like a JetBrains editor pane: title bar, syntax-highlighted body, status bar.

import React, { useState } from 'react';
import { VscJson, VscCheck, VscCopy } from 'react-icons/vsc';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

// ponytail: tiny hand-rolled highlighter — the schema is small, controlled JSON.
// A syntax lib would be 100x the code for one read-only pane. Upgrade only if the
// preview ever needs to render arbitrary/untrusted JSON.
export const highlightJson = (json: string): React.ReactNode[] => {
  const tokens = json.match(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+\.?\d*)|([{}[\],])|(\s+)|(.)/g,
  );
  if (!tokens) return [json];

  return tokens.map((tok, i) => {
    let color = '#a9b7c6'; // default (Darcula foreground)
    if (/:\s*$/.test(tok)) color = '#9876aa'; // key
    else if (/^"/.test(tok)) color = '#6a8759'; // string
    else if (/^(true|false|null)$/.test(tok)) color = '#cc7832'; // literal
    else if (/^-?\d/.test(tok)) color = '#6897bb'; // number
    else if (/^[{}[\],]$/.test(tok)) color = '#808080'; // punctuation
    else return tok;
    return (
      <span key={i} style={{ color }}>
        {tok}
      </span>
    );
  });
};

export const JsonPreviewWidget = ({ config }: { config: EnvironmentConfig }) => {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(config, null, 2);
  const lineCount = json.split('\n').length;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-[450px] sticky top-6 h-[calc(100vh-3rem)] flex flex-col rounded-xl bg-[#1c1c1c] border border-white/[0.07] shadow-2xl shadow-black/40 overflow-hidden font-jetbrains ring-1 ring-black/20">
      {/* Title bar */}
      <div className="px-4 py-2.5 bg-gradient-to-b from-[#323232] to-[#2b2b2b] border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-300">
          <VscJson className="text-[#cc7832]" size={16} />
          <span className="text-xs font-semibold tracking-wide">schema.json</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all active:scale-95 ${
            copied
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
              : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-gray-300'
          }`}
        >
          {copied ? <VscCheck size={13} /> : <VscCopy size={13} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code body with gutter */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="flex min-h-full">
          <div
            aria-hidden
            className="select-none py-4 pl-4 pr-3 text-right text-[12px] leading-relaxed text-gray-600 border-r border-white/[0.04] bg-white/[0.015]"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 py-4 px-4 text-[12px] leading-relaxed whitespace-pre">
            {highlightJson(json)}
          </pre>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 bg-gradient-to-b from-[#2d2d2d] to-[#262626] border-t border-white/[0.06] text-[10px] text-gray-500 flex justify-between items-center">
        <div className="flex gap-4">
          <span>UTF-8</span>
          <span>4 spaces</span>
          <span>{lineCount} lines</span>
        </div>
        <span className="text-[#cc7832] font-semibold">JSON</span>
      </div>
    </div>
  );
};
