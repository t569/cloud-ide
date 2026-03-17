// frontend/src/editor/components/WorkspaceEditor.jsx: our editor component

import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { getLanguageFromExtension } from '../utils/editorUtils';
import { VirtualFileSystem } from '../api/vfs';

export default function WorkspaceEditor({ sessionId, file, onFileStateChange }) {
  const editorRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false); // True if there are unsaved changes

  // Reset dirty state when the user switches to a different file tab
  useEffect(() => {
    setIsDirty(false);
  }, [file?.path]);

  // Handle the physical save to the backend
  const handleSave = async (currentContent) => {
    if (!file || !sessionId) return;
    
    try {
      setIsSaving(true);
      await VirtualFileSystem.saveFile(sessionId, file.path, currentContent);
      setIsDirty(false);
      
      // Optional: Fire a callback to the parent so it can remove the "unsaved" dot from the file tab
      if (onFileStateChange) onFileStateChange(file.path, { isDirty: false });
      
      console.log(`[VFS] ${file.name} saved successfully.`);
    } catch (error) {
      console.error(`[VFS Error] Save failed:`, error.message);
      // TODO: Hook this into a toast notification system later
    } finally {
      setIsSaving(false);
    }
  };

  // Wire up the Monaco Keybindings once the editor boots
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;

    // Hijack Ctrl+S (Windows/Linux) and Cmd+S (Mac)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentContent = editor.getValue();
      handleSave(currentContent);
    });
  };

  const handleContentChange = (value) => {
    if (!isDirty) {
      setIsDirty(true);
      if (onFileStateChange) onFileStateChange(file.path, { isDirty: true });
    }
  };

  if (!file) {
    return <div style={{ padding: '20px', color: '#888' }}>Select a file to start editing.</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Optional Save Indicator */}
      {isSaving && (
        <div style={{ position: 'absolute', top: 5, right: 15, zIndex: 10, color: '#4CAF50', fontSize: '12px' }}>
          Saving to OS...
        </div>
      )}

      <Editor
        height="100%"
        theme="vs-dark"
        language={getLanguageFromExtension(file.name)}
        value={file.content || ''}
        onChange={handleContentChange}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: 'on',
          automaticLayout: true,
          fontFamily: '"JetBrains Mono", monospace',
          fontLigatures: true,
        }}
      />
    </div>
  );
}