import React from 'react';
import Editor from '@monaco-editor/react';

// Dynamically assign the Monaco language based on the filename
const getLanguageFromExtension = (filename) => {
  if (!filename) return 'plaintext';
  
  const ext = filename.split('.').pop().toLowerCase();
  
  // Well add them as we go on lmao
  switch (ext) {
    // Web
    case 'js': case 'jsx': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'json': return 'json';
    
    // Systems & Backend
    case 'py': case 'ipynb':case 'pyc': return 'python';
    case 'rs': return 'rust';
    case 'cpp': case 'cc': case 'cxx': case 'hpp': return 'cpp';
    case 'c': case 'h': return 'c';
    case 'java': case 'jar': case 'class': return 'java';
    
    // Scripts & Docs
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'md': return 'markdown';
    case 'xml': return 'xml';
    case 'yaml': case 'yml': return 'yaml';
    
    // Assembly doesn't have a default Monaco grammar, fallback to plaintext or write a custom Monarch token provider later
    case 'asm': case 's': return 'plaintext'; 
    
    default: return 'plaintext';
  }
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
        fontFamily: '"JetBrains Mono", monospace', // NEW
        fontLigatures: true, // Bonus: Turns >= into a real math symbol!
      }}
    />
  );
}