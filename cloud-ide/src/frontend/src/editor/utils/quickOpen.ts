// frontend/src/editor/utils/quickOpen.ts
// Pure helpers for the Command Palette / quick-open. No React, no monaco.
import { FileNode } from '../types/editor';

/** Flatten the nested VFS tree down to just the files (folders aren't openable). */
export function flattenFiles(nodes: FileNode[]): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (node.type === 'directory') { if (node.children) walk(node.children); }
      else out.push({ name: node.name, path: node.path });
    }
  };
  walk(nodes);
  return out;
}

/** Case-insensitive subsequence match — VS Code–style quick open, zero deps. */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
