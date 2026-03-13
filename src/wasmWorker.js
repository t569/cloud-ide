// THIS CURRENTLY ONLY WORKS FOR A PYTHON TERMINAL

importScripts("https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js");

async function init() {
  self.postMessage({ type: 'SYSTEM', payload: 'Loading Python WASM environment...\r\n' });
  self.pyodide = await loadPyodide();
  self.postMessage({ type: 'SYSTEM', payload: 'Python ready. Virtual filesystem mounted.\r\n' });
  self.postMessage({ type: 'PROMPT' });
}

init();

// Recursive helper to write our React state into the WASM file system
function writeTreeToFS(fs, node, currentPath) {
  if (node.type === 'file') {
    if (node.content !== null) {
      fs.writeFile(currentPath, node.content);
    }
  } else if (node.type === 'folder') {
    try { fs.mkdir(currentPath); } catch (e) {} // Ignore if folder already exists
    for (const [name, child] of Object.entries(node.children)) {
      writeTreeToFS(fs, child, currentPath + '/' + name);
    }
  }
}

self.onmessage = async (event) => {
  // NEW: Handle File Synchronization
  if (event.data.type === 'SYNC_FILES') {
    if (!self.pyodide) return;
    const fileTree = event.data.payload;
    
    // Iterate through the root of our React file state and write it to WASM
    for (const [name, node] of Object.entries(fileTree)) {
      writeTreeToFS(self.pyodide.FS, node, '/' + name);
    }
    self.postMessage({ type: 'SYSTEM', payload: 'Files synced to WASM environment.\r\n' });
    self.postMessage({ type: 'PROMPT' });
    return;
  }

  // Handle Code Execution (same as before)
  if (event.data.type === 'RUN') {
    const code = event.data.payload;
    try {
      self.pyodide.setStdout({ batched: (str) => self.postMessage({ type: 'STDOUT', payload: str + '\r\n' }) });
      await self.pyodide.runPythonAsync(code);
      self.postMessage({ type: 'PROMPT' });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message + '\r\n' });
      self.postMessage({ type: 'PROMPT' });
    }
  }
};