// THIS CURRENTLY ONLY WORKS FOR A PYTHON TERMINAL

// Remove importScripts! Use ES module import instead:
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.mjs";

let isReady = false;

async function init() {
  self.postMessage({ type: 'SYSTEM', payload: 'Downloading Python WASM environment (this may take a moment)...\r\n' });
  
  try {
    // FIX: Bind stdout and stderr directly during initialization
    self.pyodide = await loadPyodide({
      stdout: (text) => self.postMessage({ type: 'STDOUT', payload: text + '\r\n' }),
      stderr: (text) => self.postMessage({ type: 'ERROR', payload: text + '\r\n' }),
    });

    isReady = true;
    self.postMessage({ type: 'SYSTEM', payload: 'Python ready. Virtual filesystem mounted.\r\n' });
    self.postMessage({ type: 'PROMPT' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', payload: 'Failed to load Pyodide: ' + err.message + '\r\n' });
  }
}

init();

function writeTreeToFS(fs, node, currentPath) {
  if (node.type === 'file') {
    if (node.content !== null) fs.writeFile(currentPath, node.content);
  } else if (node.type === 'folder') {
    try { fs.mkdir(currentPath); } catch (e) {} 
    for (const [name, child] of Object.entries(node.children)) {
      writeTreeToFS(fs, child, currentPath + '/' + name);
    }
  }
}

self.onmessage = async (event) => {
  if (event.data.type === 'SYNC_FILES') {
    if (!self.pyodide) return;
    for (const [name, node] of Object.entries(event.data.payload)) {
      writeTreeToFS(self.pyodide.FS, node, '/' + name);
    }
    return; 
  }

  if (event.data.type === 'RUN') {
    if (!isReady) {
      self.postMessage({ type: 'ERROR', payload: 'Python is still loading...\r\n' });
      self.postMessage({ type: 'PROMPT' });
      return;
    }

    const code = event.data.payload;
    try {
      const result = await self.pyodide.runPythonAsync(code);
      
      // If the user typed an expression (like 1+1), print the result
      if (result !== undefined && result !== null) {
        self.postMessage({ type: 'STDOUT', payload: result.toString() + '\r\n' });
      }
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message + '\r\n' });
    }
    self.postMessage({ type: 'PROMPT' });
  }
};