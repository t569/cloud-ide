import React from 'react';
import Editor from '@monaco-editor/react';

// Dynamically assign the Monaco language based on the filename
const getLanguageFromExtension = (filename) => {
  if (!filename) return 'plaintext';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.rs')) return 'rust';
  return 'plaintext';
};

export default function EditorComponent({ file, onChange }) {
  if (!file) {
    return <div style={{ padding: '20px', color: '#888' }}>Select a file to start editing.</div>;
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={getLanguageFromExtension(file.name)} // Fixed!
      value={file.content || ''}
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