// frontend/src/editor/components/WorkspaceEditor.jsx
import React from 'react';
import Editor from '@monaco-editor/react';
import { getLanguageFromExtension } from '../../utils/editorUtils';
import { useWorkspaceEditor } from '../hooks/useWorkspaceEditor';

// THIS IS BROKEN

// import { EditorOverlay } from './EditorOverlay'; // Modular sub-component

export default function WorkspaceEditor({ sessionId, file, onFileStateChange }) {
  const { isSaving, onMount, onChange } = useWorkspaceEditor(sessionId, file, onFileStateChange);

  if (!file) {
    return <div className="editor-placeholder">Select a file to start editing.</div>;
  }

  return (
    <div className="workspace-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <EditorOverlay isSaving={isSaving} />
      
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
