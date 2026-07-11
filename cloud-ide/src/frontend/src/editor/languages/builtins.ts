// frontend/src/editor/languages/builtins.ts
//
// The default language table. Every entry here is a language Monaco already
// ships a Monarch grammar for, so none needs a `grammar` — we only declare how
// to DETECT it and how to NAME it in the status bar. Adding a language Monaco
// lacks = a new entry (or a plugin) WITH a `grammar` thunk. Unknown files fall
// back to 'plaintext', so there's no need to list plain-text extensions.
import { LanguageContribution } from './types';

export const BUILTIN_LANGUAGES: LanguageContribution[] = [
  { id: 'javascript', label: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'typescript', label: 'TypeScript', extensions: ['.ts', '.tsx'] },
  { id: 'json', label: 'JSON', extensions: ['.json'] },
  { id: 'html', label: 'HTML', extensions: ['.html', '.htm'] },
  { id: 'css', label: 'CSS', extensions: ['.css'] },
  { id: 'scss', label: 'SCSS', extensions: ['.scss'] },
  { id: 'less', label: 'Less', extensions: ['.less'] },
  { id: 'python', label: 'Python', extensions: ['.py', '.pyw'] },
  { id: 'java', label: 'Java', extensions: ['.java'] },
  { id: 'c', label: 'C', extensions: ['.c', '.h'] },
  { id: 'cpp', label: 'C++', extensions: ['.cpp', '.hpp', '.cc', '.cxx'] },
  { id: 'csharp', label: 'C#', extensions: ['.cs'] },
  { id: 'go', label: 'Go', extensions: ['.go'] },
  { id: 'rust', label: 'Rust', extensions: ['.rs'] },
  { id: 'ruby', label: 'Ruby', extensions: ['.rb'] },
  { id: 'php', label: 'PHP', extensions: ['.php'] },
  { id: 'shell', label: 'Shell', extensions: ['.sh', '.bash', '.zsh'] },
  { id: 'yaml', label: 'YAML', extensions: ['.yaml', '.yml'] },
  { id: 'xml', label: 'XML', extensions: ['.xml'] },
  { id: 'sql', label: 'SQL', extensions: ['.sql'] },
  { id: 'markdown', label: 'Markdown', extensions: ['.md', '.markdown'] },
  { id: 'dockerfile', label: 'Dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'makefile', label: 'Makefile', filenames: ['Makefile'] },
];
