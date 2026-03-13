import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function TerminalComponent({ environment, files }) {
  const terminalRef = useRef(null);
  const workerRef = useRef(null);
  const termInstance = useRef(null);
  let currentCommand = '';

  // Initialize the Terminal UI exactly once
  useEffect(() => {
    const term = new Terminal({ theme: { background: '#1e1e1e', foreground: '#cccccc' }, cursorBlink: true, fontFamily: 'monospace', fontSize: 14 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    termInstance.current = term;

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Handle Environment Switching and Connection
  useEffect(() => {
    const term = termInstance.current;
    if (!term) return;

    term.writeln(`\x1b[1;33mSwitching environment to: ${environment}\x1b[0m`);

    if (environment === 'python-wasm') {
      workerRef.current = new Worker('/wasmWorker.js');

      workerRef.current.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'SYSTEM') term.write(`\x1b[1;36m${payload}\x1b[0m`);
        else if (type === 'STDOUT') term.write(payload);
        else if (type === 'ERROR') term.write(`\x1b[1;31m${payload}\x1b[0m`);
        else if (type === 'PROMPT') term.write('\x1b[1;32m>>> \x1b[0m');
      };

      // Sync files immediately upon connection
      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });

      term.onData((data) => {
        const code = data.charCodeAt(0);
        if (code === 13) {
          term.writeln('');
          if (currentCommand.trim() !== '') workerRef.current.postMessage({ type: 'RUN', payload: currentCommand });
          else term.write('\x1b[1;32m>>> \x1b[0m');
          currentCommand = '';
        } else if (code === 127) {
          if (currentCommand.length > 0) { currentCommand = currentCommand.slice(0, -1); term.write('\b \b'); }
        } else {
          currentCommand += data; term.write(data);
        }
      });
    } else if (environment === 'remote-linux') {
      term.writeln('\x1b[1;31mRemote Linux environment not yet connected to backend.\x1b[0m');
      // We will wire up the WebSocket here later!
    }

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      // Clear terminal event listeners to prevent duplicates when switching
      term.onData(() => {}); 
    };
  }, [environment]);

  // Sync files to WASM whenever the 'files' state changes
  useEffect(() => {
    if (environment === 'python-wasm' && workerRef.current) {
      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
    }
  }, [files, environment]);

  return <div ref={terminalRef} style={{ height: '100%', width: '100%', overflow: 'hidden' }} />;
}