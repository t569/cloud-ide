// frontend/src/utils/editorUtils.js

export const getLanguageFromExtension = (filename) => {
  if (!filename) return 'plaintext';
  
  const ext = filename.split('.').pop().toLowerCase();
  
  switch (ext) {
    case 'js': case 'jsx': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'json': return 'json';
    case 'py': case 'ipynb': case 'pyc': return 'python';
    case 'rs': return 'rust';
    case 'rb': return 'ruby';
    case 'cpp': case 'cc': case 'cxx': case 'hpp': return 'cpp';
    case 'c': case 'h': return 'c';
    case 'cs': return 'csharp';
    case 'java': case 'jar': case 'class': return 'java';
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'md': return 'markdown';
    case 'xml': return 'xml';
    case 'yaml': case 'yml': return 'yaml';
    case 'asm': case 's': return 'plaintext'; 
    default: return 'plaintext';
  }
};