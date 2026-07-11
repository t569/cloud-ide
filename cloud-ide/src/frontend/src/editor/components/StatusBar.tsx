// frontend/src/editor/components/StatusBar.tsx
import React from 'react';
import { EditorCursorState, DocumentFormatting, GitState, IDEGlobalSettings } from '../types/editor';
import type { LSPStatus } from '../lsp/types';
import { toast } from '../../notifications';

// Language-server read-out: label + dot colour per connection state. `offline`
// is intentionally muted, not red — it's the expected no-network fallback, not
// a failure the user must act on.
const LSP_UI: Record<LSPStatus, { label: string; color: string }> = {
  connecting: { label: 'LSP…', color: '#d7a860' },
  connected: { label: 'LSP', color: '#4ec99a' },
  offline: { label: 'LSP off', color: '#8a8a8a' },
};

// A status-bar affordance. Any plugin can drop one in.
export const StatusBarItem = ({
  children,
  onClick,
  title,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`flex h-full items-center gap-1 px-2 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text ${className}`}
  >
    {children}
  </button>
);

interface StatusBarProps {
  settings: IDEGlobalSettings;
  cursor: EditorCursorState;
  formatting: DocumentFormatting;
  git: GitState | null; // null when the workspace isn't a git repo
  language: string | null; // display name of the active file's language; null when no file is open
  lsp: LSPStatus | null; // language-server state; null when no server is wired for this language
}

// These read-outs are placeholders until cursor/format/git are wired to Monaco, so a
// click says so rather than doing nothing (matches the menu/panel stub behavior).
const soon = (label: string) => () =>
  toast.info(`${label} isn't wired up yet — coming soon.`, { title: 'Not implemented' });

export const StatusBar = ({ settings, cursor, formatting, git, language, lsp }: StatusBarProps) => (
  <div
    className="flex h-6 items-center justify-between border-t border-ide-border bg-ide-panel text-[11px] select-none"
    style={{ fontFamily: settings.fontFamily }}
  >
    {/* LEFT: source control (its conventional home). */}
    <div className="flex h-full items-center">
      {git && (
        <StatusBarItem onClick={soon('Source control')} title="Source control" className="gap-1.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM9 3.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM4.5 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM2 12.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM4.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM2 3.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm2.5 2v4H3.5v-4h1zM9 12a1 1 0 01-1-1V7.5A2.5 2.5 0 005.5 5H4.5v1h1A1.5 1.5 0 017 7.5V11a2 2 0 002 2h1.5v-1H9z"
            />
          </svg>
          <span>
            {git.branch}
            {git.hasChanges ? '*' : ''}
          </span>
        </StatusBarItem>
      )}
    </div>

    {/* RIGHT: document read-outs. */}
    <div className="flex h-full items-center">
      <StatusBarItem onClick={soon('Line & column')} title="Go to line">
        Ln {cursor.line}, Col {cursor.column}
      </StatusBarItem>
      <StatusBarItem onClick={soon('Indentation')} title="Indentation">
        {formatting.indentMode === 'spaces' ? 'Spaces' : 'Tabs'}: {formatting.indentSize}
      </StatusBarItem>
      <StatusBarItem onClick={soon('Encoding')} title="Encoding">
        {formatting.encoding}
      </StatusBarItem>
      <StatusBarItem onClick={soon('End of line')} title="End of line sequence">
        {formatting.eol}
      </StatusBarItem>
      {language && (
        <StatusBarItem onClick={soon('Language mode')} title="Select language mode">
          {language}
        </StatusBarItem>
      )}
      {lsp && (
        <StatusBarItem onClick={soon('Language server')} title={`Language server: ${lsp}`} className="gap-1.5">
          <span style={{ color: LSP_UI[lsp].color }}>●</span>
          {LSP_UI[lsp].label}
        </StatusBarItem>
      )}
    </div>
  </div>
);
