import React from 'react';
import Editor from '@monaco-editor/react';

export default function EditorComponent({ file, onChange }) {
  if (!file) {
    return <div style={{ padding: '20px', color: '#888' }}>Select a file to start editing.</div>;
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={file.language}
      value={file.content}
      onChange={onChange}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: 'on',
        automaticLayout: true,
      }}
    />
  );
}