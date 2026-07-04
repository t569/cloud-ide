// frontend/src/editor/components/StatusBar.tsx
import React from 'react';
import { EditorCursorState, DocumentFormatting, GitState, IDEGlobalSettings } from '../types/editor';

// --- MODULAR WRAPPER ---
// Any plugin can use this wrapper to inject a status item into the bar
export const StatusBarItem = ({ 
  children, 
  onClick, 
  className = '' 
}: { 
  children: React.ReactNode; 
  onClick?: () => void;
  className?: string;
}) => (
  <div 
    onClick={onClick}
    className={`h-full flex items-center px-2 text-xs text-[#8a8a8a] hover:text-[#cccccc] hover:bg-[#333333] cursor-pointer transition-colors ${className}`}
  >
    {children}
  </div>
);

// --- MAIN COMPONENT ---
interface StatusBarProps {
  settings: IDEGlobalSettings;
  cursor: EditorCursorState;
  formatting: DocumentFormatting;
  git: GitState | null; // Nullable in case the folder isn't a git repo
}

export const StatusBar = ({ settings, cursor, formatting, git }: StatusBarProps) => {
  return (
    // The container spans the full width at the bottom, matching your dark theme
    <div 
      className="h-6 bg-[#1e1e1e] border-t border-[#252526] flex items-center justify-between select-none"
      style={{ fontFamily: settings.fontFamily }} // Global font applied here!
    >
      {/* LEFT SIDE: Could be used for errors, warnings, or build status later */}
      <div className="flex h-full items-center">
        {/* Example placeholder for later: <StatusBarItem> 0 Errors </StatusBarItem> */}
      </div>

      {/* RIGHT SIDE: Formatting, Cursor, and Git (As seen in your image) */}
      <div className="flex h-full items-center">
        
        {/* End of Line Sequence */}
        <StatusBarItem onClick={() => console.log('Toggle CRLF/LF')}>
          {formatting.eol}
        </StatusBarItem>

        {/* Cursor Position */}
        <StatusBarItem onClick={() => console.log('Go to Line...')}>
          Line {cursor.line}:{cursor.column}
        </StatusBarItem>

        {/* File Encoding */}
        <StatusBarItem onClick={() => console.log('Change Encoding')}>
          {formatting.encoding}
        </StatusBarItem>

        {/* Indentation */}
        <StatusBarItem onClick={() => console.log('Change Indent')}>
          {formatting.indentSize} {formatting.indentMode}
        </StatusBarItem>

        {/* Git Hookup (Modular) */}
        {git && (
          <StatusBarItem 
            onClick={() => console.log('Open Git Menu')}
            className="flex gap-1"
          >
            {/* Simple Git Branch SVG Icon */}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="mt-[1px]">
              <path fillRule="evenodd" clipRule="evenodd" d="M11.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM9 3.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM4.5 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM2 12.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM4.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM2 3.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm2.5 2v4H3.5v-4h1zM9 12a1 1 0 01-1-1V7.5A2.5 2.5 0 005.5 5H4.5v1h1A1.5 1.5 0 017 7.5V11a2 2 0 002 2h1.5v-1H9z"/>
            </svg>
            <span>{git.branch}{git.hasChanges ? '*' : ''}</span>
          </StatusBarItem>
        )}
        
      </div>
    </div>
  );
};