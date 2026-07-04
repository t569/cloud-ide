// frontend/src/editor/components/WorkspaceEditor.tsx
import React from 'react';
import Editor from '@monaco-editor/react';
// ponytail: editorUtils is still .js — leaf util, imported as `any` here.
// Types arrive when the broader frontend JS→TS migration reaches it.
import { getLanguageFromExtension } from '../../utils/editorUtils';
import { useWorkspaceEditor, type WorkspaceFile } from '../hooks/useWorkspaceEditor';

interface WorkspaceEditorProps {
  sessionId: string;
  file: WorkspaceFile | null;
  onFileStateChange?: (path: string, updates: Partial<WorkspaceFile>) => void;
}

export default function WorkspaceEditor({ sessionId, file, onFileStateChange }: WorkspaceEditorProps) {
  const { isSaving, onMount, onChange } = useWorkspaceEditor(sessionId, file, onFileStateChange);

  if (!file) {
    return <div className="editor-placeholder">Select a file to start editing.</div>;
  }

  return (
    <div className="workspace-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isSaving && (
        <div style={{ position: 'absolute', top: 8, right: 16, zIndex: 10, color: '#9ca3af', fontSize: 12 }}>
          Saving…
        </div>
      )}

      <Editor
        height="100%"
        theme="vs-dark"
        language={getLanguageFromExtension(file.name)}
        path={file.path} // Critical for Monaco to manage multiple models/tabs
        value={file.content || ''}
        onChange={onChange}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          automaticLayout: true,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      />
    </div>
  );
}
