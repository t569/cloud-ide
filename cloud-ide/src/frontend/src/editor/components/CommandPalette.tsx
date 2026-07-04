// frontend/src/editor/components/CommandPalette.tsx
//
// Quick-open file switcher (Ctrl+P). A dumb, bus-driven overlay: it opens when
// EditorInputManager emits COMMAND_PALETTE and emits FILE_OPEN_REQUESTED when
// the user picks a file. It knows nothing about the VFS or Monaco.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileNode } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';
import { FileIcon } from '@frontend/common/FileIcon';
import { flattenFiles, fuzzyMatch } from '../utils/quickOpen';

interface CommandPaletteProps {
  files: FileNode[];
  eventBus: EditorEventBus;
}

const MAX_RESULTS = 50;

export const CommandPalette = ({ files, eventBus }: CommandPaletteProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const allFiles = useMemo(() => flattenFiles(files), [files]);
  const results = useMemo(
    () => allFiles.filter(f => fuzzyMatch(query, f.path)).slice(0, MAX_RESULTS),
    [allFiles, query],
  );

  // Open when Ctrl+P fires COMMAND_PALETTE on the bus.
  useEffect(() => eventBus.on('COMMAND_PALETTE', () => {
    setQuery('');
    setSelected(0);
    setOpen(true);
  }), [eventBus]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // Keep selection in range as results shrink, and scroll it into view.
  useEffect(() => { setSelected(s => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  if (!open) return null;

  const choose = (path: string) => {
    eventBus.emit('FILE_OPEN_REQUESTED', { path });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[selected]; if (r) choose(r.path); }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[600px] max-w-[90vw] bg-ide-panel border border-ide-border rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={onKeyDown}
          placeholder="Go to file..."
          className="w-full px-4 py-3 bg-transparent text-ide-text text-sm outline-none border-b border-ide-border"
        />
        <div className="max-h-[300px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ide-muted">No matching files</div>
          ) : results.map((f, i) => (
            <div
              key={f.path}
              ref={i === selected ? selectedRef : null}
              onClick={() => choose(f.path)}
              onMouseEnter={() => setSelected(i)}
              className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm ${
                i === selected ? 'bg-ide-accent/20 text-ide-text' : 'text-ide-muted hover:text-ide-text'
              }`}
            >
              <div className="flex-shrink-0"><FileIcon fileName={f.name} className="w-4 h-4" /></div>
              <span className="flex-shrink-0">{f.name}</span>
              <span className="text-xs text-ide-muted ml-2 truncate">{f.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
